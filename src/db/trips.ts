import { getDb } from './index';
import { newId } from '@/lib/id';
import type { Category, Trip, TripStatus, TripTotals } from '@/types';

interface TripRow {
  id: string;
  name: string;
  description: string;
  location: string;
  start_date: string | null;
  end_date: string | null;
  currency: string;
  purpose: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapTrip(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    currency: row.currency,
    purpose: row.purpose,
    status: row.status as TripStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface TripInput {
  name: string;
  description: string;
  location: string;
  startDate: string | null;
  endDate: string | null;
  currency: string;
  purpose: string;
}

export async function createTrip(input: TripInput): Promise<Trip> {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = newId('trip_');
  await db.runAsync(
    `INSERT INTO trips (id, name, description, location, start_date, end_date, currency, purpose, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    id,
    input.name,
    input.description,
    input.location,
    input.startDate,
    input.endDate,
    input.currency,
    input.purpose,
    now,
    now,
  );
  const trip = await getTrip(id);
  if (!trip) throw new Error('Trip could not be created');
  return trip;
}

export async function updateTrip(id: string, input: Partial<TripInput & { status: TripStatus }>): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  const map: Record<string, string> = {
    name: 'name',
    description: 'description',
    location: 'location',
    startDate: 'start_date',
    endDate: 'end_date',
    currency: 'currency',
    purpose: 'purpose',
    status: 'status',
  };
  for (const [key, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      fields.push(`${column} = ?`);
      values.push(value as string | null);
    }
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  await db.runAsync(`UPDATE trips SET ${fields.join(', ')} WHERE id = ?`, ...values, id);
}

export async function getTrip(id: string): Promise<Trip | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<TripRow>('SELECT * FROM trips WHERE id = ?', id);
  return row ? mapTrip(row) : null;
}

export async function listTrips(): Promise<Trip[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TripRow>(
    `SELECT * FROM trips ORDER BY COALESCE(start_date, created_at) DESC, created_at DESC`,
  );
  return rows.map(mapTrip);
}

export async function deleteTrip(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM trips WHERE id = ?', id);
}

export async function getTripTotals(tripId: string): Promise<TripTotals> {
  const db = await getDb();
  const summary = await db.getFirstAsync<{
    count: number;
    total: number | null;
    needs_review: number;
    pending: number;
    failed: number;
  }>(
    `SELECT COUNT(*) AS count,
            SUM(COALESCE(amount, 0)) AS total,
            SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM expenses WHERE trip_id = ?`,
    tripId,
  );
  const byCategory = await db.getAllAsync<{ category: string; total: number | null; count: number }>(
    `SELECT category, SUM(COALESCE(amount, 0)) AS total, COUNT(*) AS count
     FROM expenses WHERE trip_id = ?
     GROUP BY category ORDER BY total DESC`,
    tripId,
  );
  return {
    count: summary?.count ?? 0,
    total: summary?.total ?? 0,
    needsReview: summary?.needs_review ?? 0,
    pending: summary?.pending ?? 0,
    failed: summary?.failed ?? 0,
    byCategory: byCategory.map((c) => ({
      category: c.category as Category,
      total: c.total ?? 0,
      count: c.count,
    })),
  };
}

/** Multi-currency trips are legal; the report warns when totals mix currencies. */
export async function getTripCurrencies(tripId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ currency: string }>(
    `SELECT DISTINCT currency FROM expenses WHERE trip_id = ? ORDER BY currency`,
    tripId,
  );
  return rows.map((r) => r.currency);
}
