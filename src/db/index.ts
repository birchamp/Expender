import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    start_date TEXT,
    end_date TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    purpose TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY NOT NULL,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    merchant TEXT NOT NULL DEFAULT '',
    date TEXT,
    amount REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    subtotal REAL,
    tax REAL,
    tip REAL,
    category TEXT NOT NULL DEFAULT 'other',
    payment_method TEXT,
    description TEXT NOT NULL DEFAULT '',
    business_purpose TEXT NOT NULL DEFAULT '',
    attendees TEXT,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    confidence REAL,
    ai_model TEXT,
    ai_raw TEXT,
    issues TEXT NOT NULL DEFAULT '[]',
    edited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id, date);

  CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY NOT NULL,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    uri TEXT NOT NULL,
    original_uri TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_receipts_expense ON receipts(expense_id, position);

  CREATE TABLE IF NOT EXISTS line_items (
    id TEXT PRIMARY KEY NOT NULL,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    quantity REAL,
    amount REAL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_line_items_expense ON line_items(expense_id, position);

  CREATE TABLE IF NOT EXISTS extraction_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON extraction_jobs(status, updated_at);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  let version = row?.user_version ?? 0;

  for (let i = version; i < MIGRATIONS.length; i++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[i]);
    });
    version = i + 1;
    // PRAGMA does not accept bound parameters; `version` is a loop counter, not user input.
    await db.execAsync(`PRAGMA user_version = ${version};`);
  }
}

/**
 * Opens (once) and migrates the database. Every repository call goes through
 * this, so the schema is guaranteed to exist before the first query runs.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('expender.db');
      await migrate(db);
      return db;
    })().catch((err) => {
      // Let a later call retry rather than caching a permanently rejected promise.
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
