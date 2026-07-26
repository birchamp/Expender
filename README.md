# Expender

A phone app for turning receipt photos into a filed expense report.

You create a **trip** — name, location, dates and a plain-English description of
what you're doing there. Every receipt you scan into that trip is read by Claude
with the trip as context, so each expense comes back with not just the date and
the amount but *what was bought* and *why it was a business expense on this
particular trip*. Then you export a PDF with the receipts attached, one per page.

Built with Expo (React Native) + TypeScript. iOS and Android from one codebase.
All data stays on the device.

---

## What it does

**Trips.** A trip carries the description and location that make the AI output
specific rather than generic. "Three days on site with Nordwind GmbH to run the
migration workshop" produces a very different business purpose than an empty
description does.

**Scanning.** Take a photo or pick from the library. The receipt is saved to app
storage *before* anything else happens, then queued for extraction. Claude reads
the merchant, date, total, subtotal, tax, tip, payment method, line items and
currency off the paper, picks a category, and writes the purchase description
and business purpose from the trip context.

**Receipt photos.** Originals are retained permanently and never overwritten.
Tap a photo to crop (four draggable corners) or rotate; the crop is written as a
new file so **Revert to original** always works. Multi-page receipts attach to
one expense and are read together as a single bill.

**Review.** Every extraction is checked by code that cannot hallucinate:
subtotal + tax + tip must equal the total, line items must sum to the subtotal,
the currency must be a real ISO 4217 code, the date must be real, not in the
future, and inside the trip window. Anything that fails is listed on the expense
as a specific thing to check. Per-field and overall confidence scores from the
model feed the same gate. Nothing is auto-filed unless you turn that on.

**Reports.** PDF with a summary table (date, amount, purchase description,
business purpose, category), a per-category breakdown, and optionally every
receipt image on its own page. CSV export too. Mixed currencies and unconfirmed
expenses are called out on the report rather than quietly summed.

---

## Reliability

An expense report is a document you sign, so the app is built so that no capture
is ever lost and no number is ever silently wrong.

| Risk | What the app does |
|---|---|
| App killed mid-scan | The expense + receipt row is written before the API call. On next launch, interrupted jobs are re-queued. |
| No network / rate limit | Jobs live in SQLite with attempt counts, retried with backoff up to 3 times, then parked as `failed` with the reason — receipt intact, retry button on the expense. |
| No API key | Receipts still save. The app tells you scanning is off and where to fix it. |
| Model misreads a number | Arithmetic, date, currency and confidence checks route the expense to review with the specific discrepancy named. |
| Model returns junk | Responses are constrained by a JSON Schema at the API and re-validated with Zod on arrival; a mismatch is a retryable error, not a corrupt row. |
| Model refuses / image isn't a receipt | Handled as distinct, non-retryable outcomes with their own messages. |
| Your edits overwritten by a rescan | Once you edit an expense it is marked `edited`; a later scan refreshes confidence and review notes only. |
| Photo lost to OS cache eviction | Captures are copied into app document storage immediately. |
| Storage bloat from crops | Superseded files are pruned on launch and from Settings, never files a row still points at. |
| Report shows a half-scanned total | "Only completed expenses" is on by default and the count of excluded rows is printed on the report. |

---

## Running it

```bash
npm install
npx expo start
```

Open in Expo Go, or `npx expo run:ios` / `npx expo run:android` for a dev build.

Then in **Settings**, paste an Anthropic API key
([console.anthropic.com](https://console.anthropic.com/settings/keys)). It is
stored in the iOS Keychain / Android Keystore via `expo-secure-store` and is
sent only to `api.anthropic.com`.

### Model

Defaults to `claude-opus-5` at `medium` effort — the best accuracy per scan on
faint, crumpled and handwritten receipts. `claude-sonnet-5` and
`claude-haiku-4-5` are selectable in Settings if you'd rather trade accuracy for
cost. Extraction uses vision plus structured outputs
(`output_config.format` with a JSON Schema), so the response shape is guaranteed
by the API rather than parsed hopefully.

---

## Layout

```
app/                       expo-router screens
  (tabs)/index.tsx         trip list
  (tabs)/settings.tsx      API key, model, review thresholds
  trip/new.tsx             create trip
  trip/[id].tsx            trip detail + expense list + scan button
  trip/edit/[id].tsx       edit / archive / delete trip
  expense/[id].tsx         review and edit one expense
  crop/[receiptId].tsx     crop + rotate editor
  report/[tripId].tsx      PDF / CSV export options

src/
  ai/        client, prompt, JSON Schema + Zod, validation, retry queue
  db/        SQLite schema, migrations, repositories, settings
  lib/       image pipeline, capture, formatting, ids
  pdf/       HTML report builder, PDF and CSV export
  components/  shared UI, expense card, crop editor
```

### Notes

- `metro.config.js` stubs `node:*` specifiers. The Anthropic SDK ships Node-only
  credential-discovery code that never runs in React Native but still has to
  resolve at bundle time.
- Images sent for extraction are downscaled to a 2000px long edge (receipts are
  text-dense, so this keeps small print legible); PDF copies go to 1400px.
- The database is versioned via `PRAGMA user_version` with an append-only
  migration list in `src/db/index.ts`.

---

## Not built yet

- No currency conversion. Foreign-currency expenses are flagged and kept in
  their original currency rather than converted at a rate the app can't verify.
- No cloud sync, accounts, or multi-device. One device, one database.
- No direct submission to Concur/Expensify/etc. Export is PDF and CSV.
- No mileage, per-diem, or corporate-card reconciliation.
