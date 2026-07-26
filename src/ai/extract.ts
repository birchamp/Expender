import type Anthropic from '@anthropic-ai/sdk';
import { getClient, RefusalError } from './client';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';
import { RECEIPT_JSON_SCHEMA, ReceiptExtractionSchema, type ReceiptExtraction } from './schema';
import { toExtractionBase64 } from '@/lib/images';
import type { AppPreferences } from '@/db/settings';
import type { Trip } from '@/types';

export class NotAReceiptError extends Error {
  constructor() {
    super('That image does not look like a receipt. Attach a clearer photo or enter the expense by hand.');
    this.name = 'NotAReceiptError';
  }
}

export class MalformedResponseError extends Error {
  constructor(detail: string) {
    super(`The model returned an unusable response (${detail}).`);
    this.name = 'MalformedResponseError';
  }
}

export interface ExtractionResult {
  data: ReceiptExtraction;
  model: string;
  raw: string;
}

/** Vision + structured-output call. One expense, one or more receipt images. */
export async function extractReceipt(
  trip: Trip,
  receiptUris: string[],
  prefs: AppPreferences,
): Promise<ExtractionResult> {
  if (!receiptUris.length) throw new Error('No receipt image to scan.');

  const client = await getClient();
  const images = await Promise.all(receiptUris.map(toExtractionBase64));

  const content: Anthropic.ContentBlockParam[] = images.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  }));
  content.push({ type: 'text', text: buildUserPrompt(trip, receiptUris.length) });

  const response = await client.messages.create({
    model: prefs.model,
    // Generous: on Opus 5 thinking is on by default and shares this budget with
    // the response, so a tight cap would truncate the JSON mid-object.
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: prefs.effort,
      format: { type: 'json_schema', schema: RECEIPT_JSON_SCHEMA },
    },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new RefusalError(response.stop_details?.explanation ?? null);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new MalformedResponseError('response was truncated');
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  if (!textBlock) throw new MalformedResponseError('no text content returned');

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(textBlock.text);
  } catch {
    throw new MalformedResponseError('response was not valid JSON');
  }

  const parsed = ReceiptExtractionSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new MalformedResponseError(
      first ? `${first.path.join('.') || 'root'}: ${first.message}` : 'schema mismatch',
    );
  }
  if (!parsed.data.is_receipt) throw new NotAReceiptError();

  return { data: parsed.data, model: response.model, raw: textBlock.text };
}
