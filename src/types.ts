export type TripStatus = 'open' | 'submitted' | 'closed';

/**
 * `pending`      – receipt saved, AI extraction has not produced a result yet.
 * `needs_review` – extraction returned, but validation or confidence flagged it.
 * `confirmed`    – a human has looked at it and accepted the values.
 * `failed`       – extraction exhausted its retries; the expense still exists
 *                  with its receipt so nothing is ever lost.
 */
export type ExpenseStatus = 'pending' | 'needs_review' | 'confirmed' | 'failed';

export const CATEGORIES = [
  'airfare',
  'lodging',
  'ground_transport',
  'car_rental',
  'fuel',
  'parking_tolls',
  'meals',
  'entertainment',
  'conference_fees',
  'supplies',
  'communications',
  'shipping',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  airfare: 'Airfare',
  lodging: 'Lodging',
  ground_transport: 'Ground transport',
  car_rental: 'Car rental',
  fuel: 'Fuel',
  parking_tolls: 'Parking & tolls',
  meals: 'Meals',
  entertainment: 'Entertainment',
  conference_fees: 'Conference fees',
  supplies: 'Supplies',
  communications: 'Communications',
  shipping: 'Shipping',
  other: 'Other',
};

export interface Trip {
  id: string;
  name: string;
  description: string;
  location: string;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  currency: string;
  purpose: string;
  status: TripStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LineItem {
  id: string;
  expenseId: string;
  description: string;
  quantity: number | null;
  amount: number | null;
  position: number;
}

export interface Expense {
  id: string;
  tripId: string;
  merchant: string;
  date: string | null; // YYYY-MM-DD
  amount: number | null;
  currency: string;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  category: Category;
  paymentMethod: string | null;
  /** What was purchased. */
  description: string;
  /** Why it was a business expense, grounded in the trip. */
  businessPurpose: string;
  attendees: string | null;
  notes: string;
  status: ExpenseStatus;
  confidence: number | null;
  aiModel: string | null;
  aiRaw: string | null;
  /** Validation findings, shown to the user as review reasons. */
  issues: string[];
  /** 1 once a human has edited any field – blocks silent AI overwrite. */
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Receipt {
  id: string;
  expenseId: string;
  /** Current (possibly cropped/rotated) image used for extraction + reports. */
  uri: string;
  /** Untouched capture, so cropping is always reversible. */
  originalUri: string;
  width: number | null;
  height: number | null;
  position: number;
  createdAt: string;
}

export interface ExpenseWithReceipts extends Expense {
  receipts: Receipt[];
  lineItems: LineItem[];
}

export interface TripTotals {
  count: number;
  total: number;
  needsReview: number;
  pending: number;
  failed: number;
  byCategory: { category: Category; total: number; count: number }[];
}
