import { getDb, parseJsonArray } from './index';
import { newId } from '@/lib/id';
import type { Category, Expense, ExpenseStatus, ExpenseWithReceipts, LineItem, Receipt } from '@/types';

interface ExpenseRow {
  id: string;
  trip_id: string;
  merchant: string;
  date: string | null;
  amount: number | null;
  currency: string;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  category: string;
  payment_method: string | null;
  description: string;
  business_purpose: string;
  attendees: string | null;
  notes: string;
  status: string;
  confidence: number | null;
  ai_model: string | null;
  ai_raw: string | null;
  issues: string;
  edited: number;
  created_at: string;
  updated_at: string;
}

interface ReceiptRow {
  id: string;
  expense_id: string;
  uri: string;
  original_uri: string;
  width: number | null;
  height: number | null;
  position: number;
  created_at: string;
}

interface LineItemRow {
  id: string;
  expense_id: string;
  description: string;
  quantity: number | null;
  amount: number | null;
  position: number;
}

function mapExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    tripId: row.trip_id,
    merchant: row.merchant,
    date: row.date,
    amount: row.amount,
    currency: row.currency,
    subtotal: row.subtotal,
    tax: row.tax,
    tip: row.tip,
    category: row.category as Category,
    paymentMethod: row.payment_method,
    description: row.description,
    businessPurpose: row.business_purpose,
    attendees: row.attendees,
    notes: row.notes,
    status: row.status as ExpenseStatus,
    confidence: row.confidence,
    aiModel: row.ai_model,
    aiRaw: row.ai_raw,
    issues: parseJsonArray(row.issues),
    edited: row.edited === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReceipt(row: ReceiptRow): Receipt {
  return {
    id: row.id,
    expenseId: row.expense_id,
    uri: row.uri,
    originalUri: row.original_uri,
    width: row.width,
    height: row.height,
    position: row.position,
    createdAt: row.created_at,
  };
}

function mapLineItem(row: LineItemRow): LineItem {
  return {
    id: row.id,
    expenseId: row.expense_id,
    description: row.description,
    quantity: row.quantity,
    amount: row.amount,
    position: row.position,
  };
}

/**
 * Creates the expense row *before* any AI call so a crash, a dead battery or a
 * missing API key can never lose a captured receipt.
 */
export async function createPendingExpense(tripId: string, currency: string): Promise<Expense> {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = newId('exp_');
  await db.runAsync(
    `INSERT INTO expenses (id, trip_id, currency, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
    id,
    tripId,
    currency,
    now,
    now,
  );
  const expense = await getExpense(id);
  if (!expense) throw new Error('Expense could not be created');
  return expense;
}

export async function getExpense(id: string): Promise<Expense | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ExpenseRow>('SELECT * FROM expenses WHERE id = ?', id);
  return row ? mapExpense(row) : null;
}

export async function getExpenseWithReceipts(id: string): Promise<ExpenseWithReceipts | null> {
  const expense = await getExpense(id);
  if (!expense) return null;
  const [receipts, lineItems] = await Promise.all([listReceipts(id), listLineItems(id)]);
  return { ...expense, receipts, lineItems };
}

export async function listExpenses(tripId: string): Promise<ExpenseWithReceipts[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ExpenseRow>(
    `SELECT * FROM expenses WHERE trip_id = ?
     ORDER BY COALESCE(date, '9999-12-31') ASC, created_at ASC`,
    tripId,
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const receiptRows = await db.getAllAsync<ReceiptRow>(
    `SELECT * FROM receipts WHERE expense_id IN (${placeholders}) ORDER BY position ASC`,
    ...ids,
  );
  const lineRows = await db.getAllAsync<LineItemRow>(
    `SELECT * FROM line_items WHERE expense_id IN (${placeholders}) ORDER BY position ASC`,
    ...ids,
  );
  const receiptsByExpense = new Map<string, Receipt[]>();
  for (const r of receiptRows) {
    const list = receiptsByExpense.get(r.expense_id) ?? [];
    list.push(mapReceipt(r));
    receiptsByExpense.set(r.expense_id, list);
  }
  const linesByExpense = new Map<string, LineItem[]>();
  for (const l of lineRows) {
    const list = linesByExpense.get(l.expense_id) ?? [];
    list.push(mapLineItem(l));
    linesByExpense.set(l.expense_id, list);
  }
  return rows.map((row) => ({
    ...mapExpense(row),
    receipts: receiptsByExpense.get(row.id) ?? [],
    lineItems: linesByExpense.get(row.id) ?? [],
  }));
}

export interface ExpensePatch {
  merchant?: string;
  date?: string | null;
  amount?: number | null;
  currency?: string;
  subtotal?: number | null;
  tax?: number | null;
  tip?: number | null;
  category?: Category;
  paymentMethod?: string | null;
  description?: string;
  businessPurpose?: string;
  attendees?: string | null;
  notes?: string;
  status?: ExpenseStatus;
  confidence?: number | null;
  aiModel?: string | null;
  aiRaw?: string | null;
  issues?: string[];
  edited?: boolean;
}

const COLUMN_MAP: Record<keyof ExpensePatch, string> = {
  merchant: 'merchant',
  date: 'date',
  amount: 'amount',
  currency: 'currency',
  subtotal: 'subtotal',
  tax: 'tax',
  tip: 'tip',
  category: 'category',
  paymentMethod: 'payment_method',
  description: 'description',
  businessPurpose: 'business_purpose',
  attendees: 'attendees',
  notes: 'notes',
  status: 'status',
  confidence: 'confidence',
  aiModel: 'ai_model',
  aiRaw: 'ai_raw',
  issues: 'issues',
  edited: 'edited',
};

export async function updateExpense(id: string, patch: ExpensePatch): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const key of Object.keys(patch) as (keyof ExpensePatch)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    fields.push(`${COLUMN_MAP[key]} = ?`);
    if (key === 'issues') values.push(JSON.stringify(value ?? []));
    else if (key === 'edited') values.push(value ? 1 : 0);
    else values.push(value as string | number | null);
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  await db.runAsync(`UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`, ...values, id);
}

export async function deleteExpense(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM expenses WHERE id = ?', id);
}

/* ------------------------------- receipts -------------------------------- */

export async function addReceipt(
  expenseId: string,
  uri: string,
  originalUri: string,
  width: number | null,
  height: number | null,
): Promise<Receipt> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ next: number | null }>(
    'SELECT MAX(position) AS next FROM receipts WHERE expense_id = ?',
    expenseId,
  );
  const position = (row?.next ?? -1) + 1;
  const id = newId('rcpt_');
  await db.runAsync(
    `INSERT INTO receipts (id, expense_id, uri, original_uri, width, height, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    expenseId,
    uri,
    originalUri,
    width,
    height,
    position,
    new Date().toISOString(),
  );
  const created = await db.getFirstAsync<ReceiptRow>('SELECT * FROM receipts WHERE id = ?', id);
  if (!created) throw new Error('Receipt could not be saved');
  return mapReceipt(created);
}

export async function listReceipts(expenseId: string): Promise<Receipt[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ReceiptRow>(
    'SELECT * FROM receipts WHERE expense_id = ? ORDER BY position ASC',
    expenseId,
  );
  return rows.map(mapReceipt);
}

export async function getReceipt(id: string): Promise<Receipt | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ReceiptRow>('SELECT * FROM receipts WHERE id = ?', id);
  return row ? mapReceipt(row) : null;
}

export async function updateReceiptImage(
  id: string,
  uri: string,
  width: number | null,
  height: number | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET uri = ?, width = ?, height = ? WHERE id = ?', uri, width, height, id);
}

export async function deleteReceipt(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM receipts WHERE id = ?', id);
}

export async function listAllReceiptUris(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ uri: string; original_uri: string }>(
    'SELECT uri, original_uri FROM receipts',
  );
  return rows.flatMap((r) => [r.uri, r.original_uri]);
}

/* ------------------------------ line items ------------------------------- */

export async function listLineItems(expenseId: string): Promise<LineItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LineItemRow>(
    'SELECT * FROM line_items WHERE expense_id = ? ORDER BY position ASC',
    expenseId,
  );
  return rows.map(mapLineItem);
}

export async function replaceLineItems(
  expenseId: string,
  items: { description: string; quantity: number | null; amount: number | null }[],
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM line_items WHERE expense_id = ?', expenseId);
    for (let i = 0; i < items.length; i++) {
      await db.runAsync(
        `INSERT INTO line_items (id, expense_id, description, quantity, amount, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
        newId('li_'),
        expenseId,
        items[i].description,
        items[i].quantity,
        items[i].amount,
        i,
      );
    }
  });
}
