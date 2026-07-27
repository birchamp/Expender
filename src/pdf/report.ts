import * as Print from 'expo-print';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { toPdfBase64 } from '@/lib/images';
import { escapeHtml, formatDate, formatDateRange, formatMoney, roundMoney } from '@/lib/format';
import { CATEGORY_LABELS, type ExpenseWithReceipts, type Trip } from '@/types';

export interface ReportOptions {
  includeReceipts: boolean;
  includeLineItems: boolean;
  /** Leave out expenses still pending/failed so a report is never half-baked. */
  onlyComplete: boolean;
}

export interface ReportResult {
  uri: string;
  fileName: string;
  includedCount: number;
  excludedCount: number;
}

function safeFileName(trip: Trip): string {
  const base = trip.name.replace(/[^\w\d\- ]+/g, '').trim() || 'expense-report';
  return `${base.replace(/\s+/g, '-').toLowerCase()}-expenses.pdf`;
}

const STYLES = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1a1f2b; margin: 0; padding: 32px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: .08em; color: #5b6577; }
  .sub { color: #5b6577; font-size: 12px; margin: 0 0 2px; }
  .meta { margin: 16px 0 24px; padding: 12px 14px; background: #f4f6fa; border-radius: 8px; }
  .meta div { margin-bottom: 4px; }
  .meta div:last-child { margin-bottom: 0; }
  .label { color: #5b6577; display: inline-block; min-width: 108px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #5b6577; border-bottom: 1.5px solid #c9d1e0; padding: 6px 6px; }
  td { padding: 8px 6px; border-bottom: 1px solid #e6eaf2; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr.total td { border-top: 1.5px solid #c9d1e0; border-bottom: none; font-weight: 700; padding-top: 10px; }
  .purpose { color: #38414f; font-size: 11px; margin-top: 3px; }
  .items { color: #6b7484; font-size: 10px; margin-top: 3px; }
  .warn { background: #fff6e5; border: 1px solid #f0d3a0; border-radius: 6px; padding: 10px 12px; margin: 12px 0; font-size: 11px; }
  .receipt-page { page-break-before: always; text-align: center; }
  .receipt-page h3 { font-size: 13px; margin: 0 0 4px; }
  .receipt-page .cap { color: #5b6577; font-size: 11px; margin: 0 0 12px; }
  .receipt-page img { max-width: 100%; max-height: 800px; border: 1px solid #d8dee9; border-radius: 6px; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e6eaf2; color: #8891a1; font-size: 10px; }
`;

function expenseRows(expenses: ExpenseWithReceipts[], includeLineItems: boolean): string {
  return expenses
    .map((expense, index) => {
      const items =
        includeLineItems && expense.lineItems.length
          ? `<div class="items">${expense.lineItems
              .map((item) => {
                const qty = item.quantity ? `${item.quantity}× ` : '';
                const amount = item.amount === null ? '' : ` — ${formatMoney(item.amount, expense.currency)}`;
                return escapeHtml(`${qty}${item.description}${amount}`);
              })
              .join(' · ')}</div>`
          : '';
      return `
        <tr>
          <td class="num">${index + 1}</td>
          <td>${escapeHtml(formatDate(expense.date))}</td>
          <td>
            <strong>${escapeHtml(expense.merchant || 'Unknown merchant')}</strong>
            <div class="purpose">${escapeHtml(expense.description || '—')}</div>
            ${items}
          </td>
          <td>${escapeHtml(CATEGORY_LABELS[expense.category])}</td>
          <td>${escapeHtml(expense.businessPurpose || '—')}</td>
          <td class="num">${escapeHtml(formatMoney(expense.amount, expense.currency))}</td>
        </tr>`;
    })
    .join('');
}

async function receiptPages(expenses: ExpenseWithReceipts[]): Promise<string> {
  const pages: string[] = [];
  for (let i = 0; i < expenses.length; i++) {
    const expense = expenses[i];
    for (let r = 0; r < expense.receipts.length; r++) {
      const receipt = expense.receipts[r];
      let data: string;
      try {
        data = await toPdfBase64(receipt.uri);
      } catch {
        // A missing file must not sink the whole report.
        pages.push(
          `<div class="receipt-page"><h3>Receipt ${i + 1}</h3>
           <p class="cap">Image could not be loaded from storage.</p></div>`,
        );
        continue;
      }
      const suffix = expense.receipts.length > 1 ? ` (page ${r + 1} of ${expense.receipts.length})` : '';
      pages.push(`
        <div class="receipt-page">
          <h3>Receipt ${i + 1}${escapeHtml(suffix)} — ${escapeHtml(expense.merchant || 'Unknown merchant')}</h3>
          <p class="cap">${escapeHtml(formatDate(expense.date))} · ${escapeHtml(
            formatMoney(expense.amount, expense.currency),
          )} · ${escapeHtml(CATEGORY_LABELS[expense.category])}</p>
          <img src="data:image/jpeg;base64,${data}" />
        </div>`);
    }
  }
  return pages.join('');
}

export async function buildReportHtml(
  trip: Trip,
  allExpenses: ExpenseWithReceipts[],
  options: ReportOptions,
): Promise<{ html: string; included: ExpenseWithReceipts[]; excluded: ExpenseWithReceipts[] }> {
  const included = options.onlyComplete
    ? allExpenses.filter((e) => e.status === 'confirmed' || e.status === 'needs_review')
    : allExpenses;
  const excluded = allExpenses.filter((e) => !included.includes(e));

  const currencies = Array.from(new Set(included.map((e) => e.currency)));
  const total = roundMoney(included.reduce((sum, e) => sum + (e.amount ?? 0), 0));

  const byCategory = new Map<string, number>();
  for (const expense of included) {
    byCategory.set(expense.category, roundMoney((byCategory.get(expense.category) ?? 0) + (expense.amount ?? 0)));
  }

  const warnings: string[] = [];
  if (currencies.length > 1) {
    warnings.push(
      `This report mixes ${currencies.join(', ')}. The grand total is a raw sum and is not currency-converted.`,
    );
  }
  const unreviewed = included.filter((e) => e.status === 'needs_review').length;
  if (unreviewed > 0) {
    warnings.push(`${unreviewed} expense${unreviewed === 1 ? '' : 's'} in this report have not been confirmed yet.`);
  }
  if (excluded.length > 0) {
    warnings.push(
      `${excluded.length} expense${excluded.length === 1 ? '' : 's'} were excluded because scanning has not completed.`,
    );
  }

  const receiptsHtml = options.includeReceipts ? await receiptPages(included) : '';
  const reportCurrency = currencies.length === 1 ? currencies[0] : trip.currency;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${STYLES}</style></head><body>
    <h1>${escapeHtml(trip.name || 'Expense report')}</h1>
    <p class="sub">Expense report · ${escapeHtml(formatDateRange(trip.startDate, trip.endDate))}</p>

    <div class="meta">
      <div><span class="label">Location</span>${escapeHtml(trip.location || '—')}</div>
      <div><span class="label">Description</span>${escapeHtml(trip.description || '—')}</div>
      ${trip.purpose ? `<div><span class="label">Trip purpose</span>${escapeHtml(trip.purpose)}</div>` : ''}
      <div><span class="label">Expenses</span>${included.length}</div>
      <div><span class="label">Total</span><strong>${escapeHtml(formatMoney(total, reportCurrency))}</strong></div>
    </div>

    ${warnings.map((w) => `<div class="warn">${escapeHtml(w)}</div>`).join('')}

    <h2>Expenses</h2>
    <table>
      <thead><tr>
        <th class="num">#</th><th>Date</th><th>Merchant &amp; purchase</th>
        <th>Category</th><th>Business purpose</th><th class="num">Amount</th>
      </tr></thead>
      <tbody>
        ${
          included.length
            ? expenseRows(included, options.includeLineItems)
            : '<tr><td colspan="6">No expenses to report.</td></tr>'
        }
        <tr class="total">
          <td colspan="5">Total</td>
          <td class="num">${escapeHtml(formatMoney(total, reportCurrency))}</td>
        </tr>
      </tbody>
    </table>

    ${
      byCategory.size
        ? `<h2>Summary by category</h2>
    <table><thead><tr><th>Category</th><th class="num">Amount</th></tr></thead><tbody>
      ${Array.from(byCategory.entries())
        .sort((a, b) => b[1] - a[1])
        .map(
          ([category, amount]) =>
            `<tr><td>${escapeHtml(
              CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category,
            )}</td><td class="num">${escapeHtml(formatMoney(amount, reportCurrency))}</td></tr>`,
        )
        .join('')}
    </tbody></table>`
        : ''
    }

    <p class="footer">Generated by Expender on ${escapeHtml(
      new Date().toLocaleString(),
    )}. Amounts were read from the attached receipts and reviewed by the submitter.</p>

    ${receiptsHtml}
  </body></html>`;

  return { html, included, excluded };
}

export async function generateReportPdf(
  trip: Trip,
  expenses: ExpenseWithReceipts[],
  options: ReportOptions,
): Promise<ReportResult> {
  const { html, included, excluded } = await buildReportHtml(trip, expenses, options);
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  // Print writes to a temp path with an opaque name; move it somewhere the
  // share sheet will show a meaningful filename.
  const fileName = safeFileName(trip);
  const target = new File(Paths.cache, fileName);
  if (target.exists) target.delete();
  await new File(uri).move(target);

  return { uri: target.uri, fileName, includedCount: included.length, excludedCount: excluded.length };
}

export async function shareFile(uri: string, mimeType: string, dialogTitle: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle, UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined });
}

/* ---------------------------------- CSV ---------------------------------- */

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function generateReportCsv(trip: Trip, expenses: ExpenseWithReceipts[]): Promise<ReportResult> {
  const header = [
    'Date',
    'Merchant',
    'Category',
    'Purchase description',
    'Business purpose',
    'Currency',
    'Subtotal',
    'Tax',
    'Tip',
    'Amount',
    'Payment method',
    'Attendees',
    'Status',
    'Receipts',
    'Notes',
  ];
  const rows = expenses.map((e) =>
    [
      e.date ?? '',
      e.merchant,
      CATEGORY_LABELS[e.category],
      e.description,
      e.businessPurpose,
      e.currency,
      e.subtotal,
      e.tax,
      e.tip,
      e.amount,
      e.paymentMethod ?? '',
      e.attendees ?? '',
      e.status,
      e.receipts.length,
      e.notes,
    ]
      .map(csvCell)
      .join(','),
  );
  const csv = [header.join(','), ...rows].join('\n');

  const fileName = safeFileName(trip).replace(/\.pdf$/, '.csv');
  const target = new File(Paths.cache, fileName);
  target.create({ overwrite: true, intermediates: true });
  target.write(csv);
  return { uri: target.uri, fileName, includedCount: expenses.length, excludedCount: 0 };
}
