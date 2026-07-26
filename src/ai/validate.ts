import { parseISODate, roundMoney } from '@/lib/format';
import type { ReceiptExtraction } from './schema';
import type { AppPreferences } from '@/db/settings';
import type { ExpenseStatus, Trip } from '@/types';

export interface ValidationOutcome {
  status: Extract<ExpenseStatus, 'needs_review' | 'confirmed'>;
  issues: string[];
}

/** Amounts within a cent of each other are equal for our purposes. */
const MONEY_TOLERANCE = 0.011;
/** How far outside the trip window a date can fall before we flag it. */
const DATE_SLACK_DAYS = 3;

const ISO_4217 = /^[A-Z]{3}$/;

/**
 * Deterministic checks that run on every extraction. This is the second half
 * of reliability: the model reports its own confidence, and then arithmetic,
 * dates and currencies get verified by code that cannot hallucinate.
 *
 * Anything suspicious routes the expense to `needs_review` rather than being
 * silently corrected — the user is the authority, we just point.
 */
export function validateExtraction(
  data: ReceiptExtraction,
  trip: Trip,
  prefs: AppPreferences,
): ValidationOutcome {
  const issues: string[] = [];

  // --- required-for-filing fields -----------------------------------------
  if (data.total === null) issues.push('No total could be read from the receipt.');
  else if (data.total <= 0) issues.push('The total read from the receipt is not a positive amount.');

  if (!data.merchant || !data.merchant.trim()) issues.push('No merchant name could be read.');
  if (!data.date) issues.push('No transaction date could be read.');
  if (!data.business_purpose.trim()) issues.push('No business purpose was produced.');

  // --- arithmetic cross-check ---------------------------------------------
  if (data.total !== null && data.subtotal !== null) {
    const parts = roundMoney(data.subtotal + (data.tax ?? 0) + (data.tip ?? 0));
    if (Math.abs(parts - data.total) > MONEY_TOLERANCE) {
      issues.push(
        `Subtotal + tax + tip (${parts.toFixed(2)}) does not match the total (${data.total.toFixed(2)}).`,
      );
    }
  }
  if (data.total !== null && data.subtotal !== null && data.subtotal > data.total + MONEY_TOLERANCE) {
    issues.push('The subtotal is larger than the total.');
  }
  if (data.line_items.length > 0 && data.subtotal !== null) {
    const itemised = data.line_items.reduce((sum, item) => sum + (item.amount ?? 0), 0);
    const allPriced = data.line_items.every((item) => item.amount !== null);
    if (allPriced && Math.abs(roundMoney(itemised) - data.subtotal) > MONEY_TOLERANCE) {
      issues.push('Line items do not add up to the subtotal.');
    }
  }

  // --- currency ------------------------------------------------------------
  if (!data.currency) {
    issues.push('No currency could be determined.');
  } else if (!ISO_4217.test(data.currency.toUpperCase())) {
    issues.push(`"${data.currency}" is not a valid ISO 4217 currency code.`);
  } else if (data.currency.toUpperCase() !== trip.currency.toUpperCase()) {
    issues.push(
      `Charged in ${data.currency.toUpperCase()} but the trip reports in ${trip.currency.toUpperCase()}.`,
    );
  }

  // --- date sanity ---------------------------------------------------------
  if (data.date) {
    const parsed = parseISODate(data.date);
    if (!parsed) {
      issues.push(`"${data.date}" is not a usable date.`);
    } else {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (parsed.getTime() > today.getTime()) {
        issues.push('The receipt date is in the future.');
      }
      const start = trip.startDate ? parseISODate(trip.startDate) : null;
      const end = trip.endDate ? parseISODate(trip.endDate) : null;
      const slack = DATE_SLACK_DAYS * 24 * 60 * 60 * 1000;
      if (start && parsed.getTime() < start.getTime() - slack) {
        issues.push('The receipt date falls before the trip starts.');
      }
      if (end && parsed.getTime() > end.getTime() + slack) {
        issues.push('The receipt date falls after the trip ends.');
      }
    }
  }

  // --- model self-assessment ----------------------------------------------
  const weak = Object.entries(data.field_confidence)
    .filter(([, score]) => score < 0.6)
    .map(([field]) => field);
  if (weak.length) {
    issues.push(`Low confidence reading: ${weak.join(', ')}.`);
  }
  if (data.overall_confidence < prefs.confidenceThreshold) {
    issues.push(`Overall confidence ${(data.overall_confidence * 100).toFixed(0)}% is below your threshold.`);
  }
  for (const note of data.legibility_notes) {
    if (note.trim()) issues.push(note.trim());
  }

  const clean = issues.length === 0;
  return {
    status: clean && prefs.autoConfirmHighConfidence ? 'confirmed' : 'needs_review',
    issues,
  };
}
