import { parseISODate, roundMoney } from '@/lib/format';
import type { ReceiptExtraction } from './schema';
import type { AppPreferences } from '@/db/settings';
import type { Category, ExpenseStatus, Trip } from '@/types';

export interface ValidationOutcome {
  status: Extract<ExpenseStatus, 'needs_review' | 'confirmed'>;
  issues: string[];
}

/** Amounts within a cent of each other are equal for our purposes. */
const MONEY_TOLERANCE = 0.011;

const ISO_4217 = /^[A-Z]{3}$/;

/**
 * How far outside the trip window a receipt of each category can legitimately
 * fall, in days.
 *
 * A flat window was wrong: real trips generate spend long before the first
 * travel day and a little after the last one. Flights and hotels get booked
 * months ahead, conference registration earlier still, airport parking is paid
 * on the way out, and roaming charges land on a bill weeks later. Flagging all
 * of those trains the user to ignore the review queue, which defeats it.
 *
 * The windows are per-category because that is where the real signal is: a
 * flight 90 days early is routine, a restaurant meal 90 days early is not.
 */
const DATE_WINDOW: Record<Category, { before: number; after: number }> = {
  // Booked far in advance, sometimes a full budget cycle ahead.
  airfare: { before: 365, after: 30 },
  lodging: { before: 365, after: 14 },
  car_rental: { before: 365, after: 14 },
  conference_fees: { before: 365, after: 30 },
  // Travel-day spend: the ride to the airport, long-stay parking paid on
  // return, fuel in the rental on the way back.
  ground_transport: { before: 7, after: 7 },
  parking_tolls: { before: 7, after: 10 },
  fuel: { before: 3, after: 5 },
  // Billed in arrears by the provider.
  communications: { before: 30, after: 45 },
  shipping: { before: 30, after: 30 },
  // Bought in preparation, occasionally on the way.
  supplies: { before: 21, after: 7 },
  // Should happen while you are actually there. A dinner three weeks before
  // the trip is worth a human glance.
  meals: { before: 2, after: 2 },
  entertainment: { before: 2, after: 2 },
  other: { before: 7, after: 7 },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads naturally inside "…than usual for {noun}". */
const CATEGORY_NOUN: Record<Category, string> = {
  airfare: 'a flight',
  lodging: 'a hotel booking',
  car_rental: 'a car rental',
  conference_fees: 'a registration fee',
  ground_transport: 'ground transport',
  parking_tolls: 'parking',
  fuel: 'fuel',
  communications: 'a phone or data charge',
  shipping: 'shipping',
  supplies: 'supplies',
  meals: 'a meal',
  entertainment: 'entertainment',
  other: 'this category',
};

function describeGap(days: number): string {
  if (days === 1) return '1 day';
  if (days < 45) return `${days} days`;
  const months = Math.round(days / 30);
  return `about ${months} month${months === 1 ? '' : 's'}`;
}

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
      const window = DATE_WINDOW[data.category] ?? DATE_WINDOW.other;

      if (start && parsed.getTime() < start.getTime()) {
        const daysEarly = Math.round((start.getTime() - parsed.getTime()) / DAY_MS);
        if (daysEarly > window.before) {
          issues.push(
            `Dated ${describeGap(daysEarly)} before the trip starts — further ahead than usual for ${
              CATEGORY_NOUN[data.category]
            }. Check it belongs to this trip.`,
          );
        }
      }
      if (end && parsed.getTime() > end.getTime()) {
        const daysLate = Math.round((parsed.getTime() - end.getTime()) / DAY_MS);
        if (daysLate > window.after) {
          issues.push(
            `Dated ${describeGap(daysLate)} after the trip ends — later than usual for ${
              CATEGORY_NOUN[data.category]
            }. Check it belongs to this trip.`,
          );
        }
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
