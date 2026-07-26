import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getDb } from './index';

const API_KEY_SLOT = 'expender_anthropic_api_key';

/** Non-secret preferences live in SQLite; the API key lives in the keychain. */
export interface AppPreferences {
  model: string;
  effort: 'low' | 'medium' | 'high';
  defaultCurrency: string;
  includeReceiptsInPdf: boolean;
  autoConfirmHighConfidence: boolean;
  confidenceThreshold: number;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  model: 'claude-opus-5',
  effort: 'medium',
  defaultCurrency: 'USD',
  includeReceiptsInPdf: true,
  autoConfirmHighConfidence: false,
  confidenceThreshold: 0.8,
};

export const AVAILABLE_MODELS: { id: string; label: string; note: string }[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', note: 'Most accurate — recommended' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Faster and cheaper' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Cheapest; least accurate' },
];

export async function getPreferences(): Promise<AppPreferences> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM app_settings');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const raw = map.get(key);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    model: map.get('model') ?? DEFAULT_PREFERENCES.model,
    effort: (map.get('effort') as AppPreferences['effort']) ?? DEFAULT_PREFERENCES.effort,
    defaultCurrency: map.get('defaultCurrency') ?? DEFAULT_PREFERENCES.defaultCurrency,
    includeReceiptsInPdf: (map.get('includeReceiptsInPdf') ?? '1') === '1',
    autoConfirmHighConfidence: (map.get('autoConfirmHighConfidence') ?? '0') === '1',
    confidenceThreshold: num('confidenceThreshold', DEFAULT_PREFERENCES.confidenceThreshold),
  };
}

export async function setPreference<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K],
): Promise<void> {
  const db = await getDb();
  const encoded = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  await db.runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    encoded,
  );
}

/* -------------------------------- API key -------------------------------- */

export async function getApiKey(): Promise<string | null> {
  if (Platform.OS === 'web') {
    // SecureStore has no web implementation; the web target is dev-only.
    try {
      return globalThis.localStorage?.getItem(API_KEY_SLOT) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(API_KEY_SLOT);
  } catch {
    return null;
  }
}

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (Platform.OS === 'web') {
    if (trimmed) globalThis.localStorage?.setItem(API_KEY_SLOT, trimmed);
    else globalThis.localStorage?.removeItem(API_KEY_SLOT);
    return;
  }
  if (trimmed) await SecureStore.setItemAsync(API_KEY_SLOT, trimmed);
  else await SecureStore.deleteItemAsync(API_KEY_SLOT);
}

export function maskApiKey(key: string | null): string {
  if (!key) return 'Not set';
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
