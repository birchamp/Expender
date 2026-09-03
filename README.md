# Expender

A phone app for turning receipt photos into a filed expense report.

You create a **trip** — name, location, dates and a plain-English description of
what you're doing there. Every receipt you scan into that trip is read by Claude
with the trip as context, so each expense comes back with not just the date and
the amount but *what was bought* and *why it was a business expense on this
particular trip*. Then you export a PDF with the receipts attached, one per page.

Built with **Expo SDK 56** (React Native 0.85, React 19.2) + TypeScript. iOS and
Android from one codebase. All data stays on the device.

---

## What it does

**Trips.** A trip carries the description and location that make the AI output
specific rather than generic. "Three days on site with Nordwind GmbH to run the
migration workshop" produces a very different business purpose than an empty
description does. Dates are picked from a native calendar, and describe the days
on the ground — not the window in which money was spent.

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
the currency must be a real ISO 4217 code, and the date must be real and not in
the future. Date-vs-trip checking is per-category, because a flight booked three
months early is routine and a restaurant meal three months early is not — see
below. Anything that fails is listed on the expense as a specific thing to
check. Per-field and overall confidence scores from the
model feed the same gate. Nothing is auto-filed unless you turn that on.

**Expenses outside the travel dates.** Trips generate spend before and after
the days on the ground: flights, hotels and conference registration booked
months ahead; airport parking, the ride home and roaming charges landing after.
Both the extraction prompt and the review gate expect this. Each category has
its own tolerance — 365 days early for airfare and lodging, 45 days late for
phone bills, but only 2 days either side for meals — so advance bookings pass
silently while a genuinely odd date still gets flagged, with the reason named.

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

There are two ways in, and which one you want depends on whether you have a
computer in the loop.

### Just put it on an Android phone

[**Download the APK**](https://github.com/birchamp/Expender/releases/download/android-latest/expender-android-arm64.apk)
and tap it. Android will ask you to allow installs from your browser the first
time; after that it is an ordinary installed app.

That link is permanent — every build replaces the file behind it, so it always
resolves to the current APK.

This needs no computer, no Expo Go, and no dev server — the JS is bundled into
the APK, so the SDK version of your Expo Go stops mattering entirely. GitHub
Actions rebuilds it on every push (`.github/workflows/android-apk.yml`), and
you can kick off a build by hand from the repo's **Actions** tab.

It is signed with Expo's debug keystore, which is what makes it installable
without a Play Store account. That is fine for putting the app on your own
phone and is deliberately not a distributable build.

The APK is built for **arm64-v8a** only, which is every Android phone made
since roughly 2017. A universal APK carries native code for four ABIs and runs
about 105MB; dropping the three your phone will never execute takes it to
around 40MB. The cost is that it will not install on a 32-bit device or an x86
emulator — for those, build without the filter:

```bash
cd android && ./gradlew assembleRelease   # all four ABIs
```

### Develop against it

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone, or press `i` / `a` for a
simulator. Every native module the app uses is bundled in Expo Go, so no custom
dev build is required — `npx expo run:ios` / `npx expo run:android` also work if
you prefer one.

### Your Expo Go has to be an SDK 56 build

Expo Go only ever runs one SDK, and this project is on **SDK 56**. Check
**Settings → App Info → Supported SDKs** in Expo Go; it needs to say `56`. The
dev server advertises `runtimeVersion: exposdk:56.0.0`, and a newer Expo Go will
refuse the project rather than run it badly.

The App Store and Play Store now ship Expo Go for SDK 57, so an SDK 56 build is
one you already have installed — let it auto-update and this project stops
opening. When that happens, move the project forward instead of hunting for the
old client:

```bash
npm install expo@^57 && npx expo install --fix
```

That is the whole upgrade; the app builds clean on SDK 57 with no code changes.

`npx expo start --web` runs it in a browser. Useful for exercising the trip,
review, report and PDF screens quickly; the camera and keychain fall back to a
file picker and `localStorage` there, so treat web as a convenience, not the
real target.

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

### Testing without a device

```bash
npm run verify    # typecheck + the checks below
npm run check     # deterministic validation + input parsing
```

`scripts/check-logic.ts` exercises the parts that don't need a phone: the
validation gate (arithmetic reconciliation, currency, date window, confidence
thresholds, auto-confirm behaviour) and the money/date parsers. It needs no API
key and no network.

The camera, crop gestures and a live extraction round-trip can only be tested on
a device.

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

scripts/check-logic.ts    device-free checks for validation + parsing
```

### Notes

- `metro.config.js` stubs `node:*` specifiers. The Anthropic SDK ships Node-only
  credential-discovery code that never runs in React Native but still has to
  resolve at bundle time.
- File storage uses the SDK 54+ `File` / `Directory` / `Paths` API from
  `expo-file-system`, not the deprecated `expo-file-system/legacy` shim.
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
