/**
 * Headless exercise of the parts of Expender that don't need a device:
 * the deterministic validation gate and the input parsers.
 */
import { validateExtraction } from '@/ai/validate';
import { normaliseDateInput, parseAmountInput, roundMoney } from '@/lib/format';
import type { ReceiptExtraction } from '@/ai/schema';
import type { Trip } from '@/types';
import type { AppPreferences } from '@/db/settings';

const trip: Trip = {
  id: 't1',
  name: 'Berlin client visit',
  description: 'Migration workshop with Nordwind GmbH',
  location: 'Berlin, Germany',
  startDate: '2026-03-14',
  endDate: '2026-03-18',
  currency: 'EUR',
  purpose: 'Implementation support',
  status: 'open',
  createdAt: '',
  updatedAt: '',
};

const prefs: AppPreferences = {
  model: 'claude-opus-5',
  effort: 'medium',
  defaultCurrency: 'EUR',
  includeReceiptsInPdf: true,
  autoConfirmHighConfidence: false,
  confidenceThreshold: 0.8,
};

const clean: ReceiptExtraction = {
  is_receipt: true,
  merchant: 'Restaurant Nobelhart',
  merchant_location: 'Berlin',
  date: '2026-03-15',
  time: '20:15',
  currency: 'EUR',
  total: 118.4,
  subtotal: 99.5,
  tax: 8.9,
  tip: 10,
  payment_method: 'Visa ••4242',
  category: 'meals',
  purchase_description: 'Dinner for three',
  business_purpose: 'Working dinner with the Nordwind implementation team.',
  attendees: 'J. Weber, S. Klein',
  line_items: [
    { description: 'Tasting menu x3', quantity: 3, amount: 87.0 },
    { description: 'Mineral water', quantity: 2, amount: 12.5 },
  ],
  field_confidence: { merchant: 0.97, date: 0.95, total: 0.99, currency: 0.98, category: 0.94 },
  overall_confidence: 0.95,
  legibility_notes: [],
};

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nValidation gate\n');

// 1. A clean receipt with everything consistent.
const r1 = validateExtraction(clean, trip, prefs);
check('clean receipt raises no issues', r1.issues.length === 0, r1.issues.join(' | '));
check('clean receipt still requires human confirm by default', r1.status === 'needs_review');

// 2. Same receipt with auto-confirm enabled.
const r2 = validateExtraction(clean, trip, { ...prefs, autoConfirmHighConfidence: true });
check('auto-confirm files a clean receipt', r2.status === 'confirmed');

// 3. Arithmetic that does not reconcile — the classic OCR digit error.
const badMaths = { ...clean, total: 128.4 };
const r3 = validateExtraction(badMaths, trip, prefs);
check(
  'total that does not equal subtotal+tax+tip is caught',
  r3.issues.some((i) => i.includes('does not match the total')),
  r3.issues.join(' | '),
);
check('arithmetic failure blocks auto-confirm', validateExtraction(badMaths, trip, { ...prefs, autoConfirmHighConfidence: true }).status === 'needs_review');

// 4. Line items that do not sum to the subtotal.
const badItems = { ...clean, line_items: [{ description: 'Tasting menu x3', quantity: 3, amount: 87.0 }] };
const r4 = validateExtraction(badItems, trip, prefs);
check('line items that miss the subtotal are caught', r4.issues.some((i) => i.includes('Line items do not add up')), r4.issues.join(' | '));

// 5. Currency mismatch against the trip.
const r5 = validateExtraction({ ...clean, currency: 'USD' }, trip, prefs);
check('currency differing from the trip is flagged', r5.issues.some((i) => i.includes('USD') && i.includes('EUR')), r5.issues.join(' | '));

// 6. Nonsense currency code.
const r6 = validateExtraction({ ...clean, currency: 'EU' }, trip, prefs);
check('invalid ISO 4217 code is rejected', r6.issues.some((i) => i.includes('ISO 4217')), r6.issues.join(' | '));

// 7. Date outside the trip window (beyond the 3-day slack).
const r7 = validateExtraction({ ...clean, date: '2026-02-01' }, trip, prefs);
check('date before the trip is flagged', r7.issues.some((i) => i.includes('before the trip')), r7.issues.join(' | '));

// 8. Future-dated receipt.
const r8 = validateExtraction({ ...clean, date: '2099-01-01' }, trip, prefs);
check('future date is flagged', r8.issues.some((i) => i.includes('future')), r8.issues.join(' | '));

// 9. A date just inside the slack window must NOT be flagged.
const r9 = validateExtraction({ ...clean, date: '2026-03-13' }, trip, prefs);
check('date one day early is tolerated', !r9.issues.some((i) => i.includes('before the trip')), r9.issues.join(' | '));

// 10. Missing total.
const r10 = validateExtraction({ ...clean, total: null, subtotal: null, tax: null, tip: null }, trip, prefs);
check('missing total is caught', r10.issues.some((i) => i.includes('No total')), r10.issues.join(' | '));

// 11. Low per-field confidence.
const r11 = validateExtraction(
  { ...clean, field_confidence: { ...clean.field_confidence, date: 0.3 } },
  trip,
  prefs,
);
check('low field confidence surfaces the field name', r11.issues.some((i) => i.includes('date')), r11.issues.join(' | '));

// 12. Model's own legibility notes are surfaced verbatim.
const r12 = validateExtraction({ ...clean, legibility_notes: ['Tip line is handwritten and smudged.'] }, trip, prefs);
check('model legibility notes reach the user', r12.issues.includes('Tip line is handwritten and smudged.'), r12.issues.join(' | '));

console.log('\nInput parsing\n');

check('parses "$1,234.50"', parseAmountInput('$1,234.50') === 1234.5);
check('parses European "1.234,50"', parseAmountInput('1.234,50') === 1234.5);
check('parses accounting negative "(12.00)"', parseAmountInput('(12.00)') === -12);
check('rejects empty input', parseAmountInput('   ') === null);
check('parses "€ 42"', parseAmountInput('€ 42') === 42);

check('normalises 3/14/2026', normaliseDateInput('3/14/2026') === '2026-03-14');
check('normalises 14/3/2026 (day-first, unambiguous)', normaliseDateInput('14/3/2026') === '2026-03-14');
check('passes through ISO', normaliseDateInput('2026-03-14') === '2026-03-14');
check('rejects impossible date 2026-02-30', normaliseDateInput('2026-02-30') === null);
check('rejects free text', normaliseDateInput('last tuesday') === null);

check('roundMoney fixes float drift', roundMoney(0.1 + 0.2) === 0.3);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
