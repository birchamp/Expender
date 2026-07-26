import { getDb } from '@/db';
import { newId } from '@/lib/id';
import {
  getExpenseWithReceipts,
  replaceLineItems,
  updateExpense,
  type ExpensePatch,
} from '@/db/expenses';
import { getTrip } from '@/db/trips';
import { getPreferences } from '@/db/settings';
import { describeError, isRetryable, MissingApiKeyError } from './client';
import { extractReceipt, NotAReceiptError } from './extract';
import { validateExtraction } from './validate';
import { roundMoney } from '@/lib/format';
import { CATEGORIES, type Category } from '@/types';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 2_000, 6_000];

type Listener = () => void;
const listeners = new Set<Listener>();

/** Screens subscribe so a finished background scan repaints the list. */
export function subscribeToExtractions(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A misbehaving subscriber must not break the queue.
    }
  }
}

/** Expense ids with an in-flight scan, so the UI can show a spinner. */
const running = new Set<string>();

export function isExtracting(expenseId: string): boolean {
  return running.has(expenseId);
}

export async function enqueueExtraction(expenseId: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM extraction_jobs WHERE expense_id = ? AND status IN ('queued', 'running')",
    expenseId,
  );
  if (!existing) {
    await db.runAsync(
      `INSERT INTO extraction_jobs (id, expense_id, status, attempts, created_at, updated_at)
       VALUES (?, ?, 'queued', 0, ?, ?)`,
      newId('job_'),
      expenseId,
      now,
      now,
    );
  }
  void runQueue();
}

/** Re-run a scan the user asked for again (e.g. after adding a clearer photo). */
export async function retryExtraction(expenseId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE extraction_jobs SET status = 'queued', attempts = 0, last_error = NULL, updated_at = ?
     WHERE expense_id = ?`,
    new Date().toISOString(),
    expenseId,
  );
  await updateExpense(expenseId, { status: 'pending' });
  await enqueueExtraction(expenseId);
  notify();
}

let queueRunning = false;

/**
 * Drains the persisted job table one job at a time. Serial by design: a burst
 * of receipts should not fire ten concurrent vision calls into a rate limit.
 */
export async function runQueue(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (;;) {
      const db = await getDb();
      const job = await db.getFirstAsync<{ id: string; expense_id: string; attempts: number }>(
        "SELECT id, expense_id, attempts FROM extraction_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
      );
      if (!job) break;

      await db.runAsync(
        "UPDATE extraction_jobs SET status = 'running', updated_at = ? WHERE id = ?",
        new Date().toISOString(),
        job.id,
      );
      running.add(job.expense_id);
      notify();

      const attempt = job.attempts + 1;
      try {
        await processExpense(job.expense_id);
        await db.runAsync(
          "UPDATE extraction_jobs SET status = 'done', attempts = ?, last_error = NULL, updated_at = ? WHERE id = ?",
          attempt,
          new Date().toISOString(),
          job.id,
        );
      } catch (error) {
        const message = describeError(error);
        const canRetry = isRetryable(error) && attempt < MAX_ATTEMPTS;
        await db.runAsync(
          `UPDATE extraction_jobs SET status = ?, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          canRetry ? 'queued' : 'error',
          attempt,
          message,
          new Date().toISOString(),
          job.id,
        );
        if (canRetry) {
          running.delete(job.expense_id);
          notify();
          await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
          continue;
        }
        // Terminal: keep the receipt and the expense, record why, let the user
        // retry or type the values in by hand.
        await updateExpense(job.expense_id, {
          status: 'failed',
          issues: [message],
        });
        if (error instanceof MissingApiKeyError) {
          // Nothing else in the queue can succeed either — stop draining.
          running.delete(job.expense_id);
          notify();
          break;
        }
      } finally {
        running.delete(job.expense_id);
        notify();
      }
    }
  } finally {
    queueRunning = false;
  }
}

async function processExpense(expenseId: string): Promise<void> {
  const expense = await getExpenseWithReceipts(expenseId);
  if (!expense) return; // deleted while queued — nothing to do
  if (!expense.receipts.length) {
    throw new Error('This expense has no receipt image to scan.');
  }
  const trip = await getTrip(expense.tripId);
  if (!trip) throw new Error('The trip for this expense no longer exists.');

  const prefs = await getPreferences();
  const uris = expense.receipts.map((r) => r.uri);

  try {
    const { data, model, raw } = await extractReceipt(trip, uris, prefs);
    const outcome = validateExtraction(data, trip, prefs);

    // A field the user already edited by hand is never overwritten by a rescan.
    const patch: ExpensePatch = {
      status: outcome.status,
      issues: outcome.issues,
      confidence: data.overall_confidence,
      aiModel: model,
      aiRaw: raw,
    };
    if (!expense.edited) {
      patch.merchant = data.merchant?.trim() ?? '';
      patch.date = data.date;
      patch.amount = data.total === null ? null : roundMoney(data.total);
      patch.currency = (data.currency ?? trip.currency).toUpperCase();
      patch.subtotal = data.subtotal === null ? null : roundMoney(data.subtotal);
      patch.tax = data.tax === null ? null : roundMoney(data.tax);
      patch.tip = data.tip === null ? null : roundMoney(data.tip);
      patch.category = normaliseCategory(data.category);
      patch.paymentMethod = data.payment_method;
      patch.description = data.purchase_description.trim();
      patch.businessPurpose = data.business_purpose.trim();
      patch.attendees = data.attendees;
    }
    await updateExpense(expenseId, patch);
    if (!expense.edited) {
      await replaceLineItems(
        expenseId,
        data.line_items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          amount: item.amount === null ? null : roundMoney(item.amount),
        })),
      );
    }
  } catch (error) {
    if (error instanceof NotAReceiptError) {
      // Not transient and not really a failure of ours — park it for the user.
      await updateExpense(expenseId, {
        status: 'needs_review',
        issues: [error.message],
      });
      return;
    }
    throw error;
  }
}

function normaliseCategory(value: string): Category {
  return (CATEGORIES as readonly string[]).includes(value) ? (value as Category) : 'other';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Re-queues anything left `running` by an app kill. Called at startup. */
export async function recoverInterruptedJobs(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE extraction_jobs SET status = 'queued', updated_at = ? WHERE status = 'running'",
    new Date().toISOString(),
  );
  void runQueue();
}
