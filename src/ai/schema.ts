import { z } from 'zod';
import { CATEGORIES } from '@/types';

/**
 * The JSON Schema handed to the Messages API via `output_config.format`, and a
 * matching Zod schema used to validate what comes back.
 *
 * Both exist on purpose: the API guarantees the *shape*, Zod guarantees the
 * *types we actually rely on* even if the schema and the model drift, and gives
 * us a typed object instead of `any`. Every field is required-and-nullable —
 * `null` means "not legible on this receipt", which is very different from the
 * model silently omitting a key.
 */

const confidence = z.number().min(0).max(1);

export const ReceiptExtractionSchema = z.object({
  is_receipt: z.boolean(),
  merchant: z.string().nullable(),
  merchant_location: z.string().nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  time: z.string().nullable(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .nullable(),
  total: z.number().nullable(),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  tip: z.number().nullable(),
  payment_method: z.string().nullable(),
  category: z.enum(CATEGORIES),
  purchase_description: z.string(),
  business_purpose: z.string(),
  attendees: z.string().nullable(),
  line_items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().nullable(),
      amount: z.number().nullable(),
    }),
  ),
  field_confidence: z.object({
    merchant: confidence,
    date: confidence,
    total: confidence,
    currency: confidence,
    category: confidence,
  }),
  overall_confidence: confidence,
  legibility_notes: z.array(z.string()),
});

export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const confidenceProp = { type: 'number', description: '0.0 (guess) to 1.0 (certain)' };

export const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_receipt',
    'merchant',
    'merchant_location',
    'date',
    'time',
    'currency',
    'total',
    'subtotal',
    'tax',
    'tip',
    'payment_method',
    'category',
    'purchase_description',
    'business_purpose',
    'attendees',
    'line_items',
    'field_confidence',
    'overall_confidence',
    'legibility_notes',
  ],
  properties: {
    is_receipt: {
      type: 'boolean',
      description: 'False if the image is not a receipt, invoice or bill at all.',
    },
    merchant: { ...nullableString, description: 'Merchant / vendor name exactly as printed.' },
    merchant_location: { ...nullableString, description: 'City, or city and region, if printed.' },
    date: {
      ...nullableString,
      description: 'Transaction date as YYYY-MM-DD. Null if not legible. Never guess the year.',
    },
    time: { ...nullableString, description: 'Transaction time as HH:MM (24h) if printed.' },
    currency: {
      ...nullableString,
      description: 'ISO 4217 code, e.g. USD, EUR, GBP, JPY. Infer from symbol and location.',
    },
    total: { ...nullableNumber, description: 'Grand total actually paid, as a number.' },
    subtotal: nullableNumber,
    tax: { ...nullableNumber, description: 'Total tax/VAT/GST.' },
    tip: { ...nullableNumber, description: 'Gratuity, if shown separately.' },
    payment_method: {
      ...nullableString,
      description: 'e.g. "Visa ••1234", "Cash", "Amex". Include only the last 4 digits.',
    },
    category: {
      type: 'string',
      enum: [...CATEGORIES],
      description: 'Best-fit expense category.',
    },
    purchase_description: {
      type: 'string',
      description:
        'One short line naming what was actually bought, inferred from the line items and merchant. e.g. "Dinner for 3 at a steakhouse", "Two checked bags", "3 nights lodging".',
    },
    business_purpose: {
      type: 'string',
      description:
        'One or two sentences stating why this is a legitimate business expense, written specifically for THIS trip using its description, location and dates. Never generic filler.',
    },
    attendees: {
      ...nullableString,
      description: 'Named or implied attendees for meals/entertainment, if determinable.',
    },
    line_items: {
      type: 'array',
      description: 'Individual purchased items, when legible. Empty array if not itemised.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'quantity', 'amount'],
        properties: {
          description: { type: 'string' },
          quantity: nullableNumber,
          amount: nullableNumber,
        },
      },
    },
    field_confidence: {
      type: 'object',
      additionalProperties: false,
      required: ['merchant', 'date', 'total', 'currency', 'category'],
      properties: {
        merchant: confidenceProp,
        date: confidenceProp,
        total: confidenceProp,
        currency: confidenceProp,
        category: confidenceProp,
      },
    },
    overall_confidence: {
      type: 'number',
      description:
        'Overall confidence that this extraction is correct and could be filed without human correction.',
    },
    legibility_notes: {
      type: 'array',
      description:
        'Short notes about anything unreadable, ambiguous or unusual that a human should check. Empty array if the receipt was clean.',
      items: { type: 'string' },
    },
  },
} as const;
