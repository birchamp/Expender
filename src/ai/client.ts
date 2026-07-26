import Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from '@/db/settings';

export class MissingApiKeyError extends Error {
  constructor() {
    super('No Anthropic API key is set. Add one in Settings to scan receipts.');
    this.name = 'MissingApiKeyError';
  }
}

export class RefusalError extends Error {
  constructor(explanation?: string | null) {
    super(explanation ? `The model declined this request: ${explanation}` : 'The model declined this request.');
    this.name = 'RefusalError';
  }
}

let cached: { key: string; client: Anthropic } | null = null;

/**
 * Builds (and memoises) a client for the key currently in the keychain.
 * `dangerouslyAllowBrowser` is required because React Native presents a
 * browser-like environment to the SDK; the key never leaves the device except
 * in the request to api.anthropic.com.
 */
export async function getClient(): Promise<Anthropic> {
  const key = await getApiKey();
  if (!key) throw new MissingApiKeyError();
  if (cached && cached.key === key) return cached.client;
  const client = new Anthropic({
    apiKey: key,
    dangerouslyAllowBrowser: true,
    // Our own queue owns retry/backoff so it can persist attempt counts.
    maxRetries: 0,
    timeout: 120_000,
  });
  cached = { key, client };
  return client;
}

export function invalidateClient(): void {
  cached = null;
}

/** True for transient failures worth another attempt. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof MissingApiKeyError || error instanceof RefusalError) return false;
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === 'number') {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  // No status at all: almost always a network drop. Worth retrying.
  const name = (error as { name?: string } | null)?.name;
  return name === 'APIConnectionError' || name === 'APIConnectionTimeoutError' || name === 'TypeError';
}

export function describeError(error: unknown): string {
  if (error instanceof MissingApiKeyError || error instanceof RefusalError) return error.message;
  const status = (error as { status?: number } | null)?.status;
  const message = (error as { message?: string } | null)?.message ?? String(error);
  if (status === 401) return 'Your API key was rejected. Check it in Settings.';
  if (status === 403) return 'This API key does not have access to the selected model.';
  if (status === 404) return 'The selected model is not available to this API key.';
  if (status === 429) return 'Rate limited by the API. It will retry shortly.';
  if (typeof status === 'number' && status >= 500) return 'The API is temporarily unavailable.';
  if (/network|fetch|timeout/i.test(message)) return 'Network unavailable. Scanning will retry.';
  return message;
}
