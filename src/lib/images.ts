import * as FileSystem from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';
import { newId } from './id';

const RECEIPTS_DIR = `${FileSystem.documentDirectory}receipts/`;

/** Long-edge cap for the copy sent to the model. Receipts are text-dense, so
 *  we keep more resolution than a normal photo would need. */
const EXTRACTION_MAX_EDGE = 2000;
/** Long-edge cap for images embedded in the PDF — keeps report files sane. */
const PDF_MAX_EDGE = 1400;

export interface StoredImage {
  uri: string;
  width: number | null;
  height: number | null;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(RECEIPTS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(RECEIPTS_DIR, { intermediates: true });
  }
}

export function getImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null),
    );
  });
}

/**
 * Copies a freshly-captured image out of the OS cache into app storage.
 * The cache directory is reclaimed by the OS at will, so this copy is what
 * makes receipt retention actually durable.
 */
export async function persistCapturedImage(sourceUri: string): Promise<StoredImage> {
  await ensureDir();
  const target = `${RECEIPTS_DIR}${newId('r_')}.jpg`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  const size = await getImageSize(target);
  return { uri: target, width: size?.width ?? null, height: size?.height ?? null };
}

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

async function render(
  sourceUri: string,
  apply: (context: ReturnType<typeof ImageManipulator.manipulate>) => void,
): Promise<StoredImage> {
  await ensureDir();
  const context = ImageManipulator.manipulate(sourceUri);
  apply(context);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });

  const target = `${RECEIPTS_DIR}${newId('r_')}.jpg`;
  await FileSystem.moveAsync({ from: saved.uri, to: target });
  const size = await getImageSize(target);
  return { uri: target, width: size?.width ?? null, height: size?.height ?? null };
}

/**
 * Writes a cropped copy as a *new* file. The original capture is never
 * mutated, so a crop is always reversible from the expense screen.
 * `crop` is in pixels of `sourceUri`.
 */
export function cropImage(sourceUri: string, crop: CropRect): Promise<StoredImage> {
  return render(sourceUri, (context) =>
    context.crop({
      originX: Math.max(0, Math.round(crop.originX)),
      originY: Math.max(0, Math.round(crop.originY)),
      width: Math.max(1, Math.round(crop.width)),
      height: Math.max(1, Math.round(crop.height)),
    }),
  );
}

/** Rotates 90° clockwise and writes a new file, so the editor stays WYSIWYG. */
export function rotateImage(sourceUri: string): Promise<StoredImage> {
  return render(sourceUri, (context) => context.rotate(90));
}

async function downscaleToBase64(uri: string, maxEdge: number, compress: number): Promise<string> {
  const size = await getImageSize(uri);
  const context = ImageManipulator.manipulate(uri);
  if (size) {
    const longEdge = Math.max(size.width, size.height);
    if (longEdge > maxEdge) {
      const scale = maxEdge / longEdge;
      context.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
      });
    }
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress,
    base64: true,
  });
  if (saved.base64) {
    // The manipulator writes a temp file even when base64 is requested.
    await FileSystem.deleteAsync(saved.uri, { idempotent: true });
    return saved.base64;
  }
  const data = await FileSystem.readAsStringAsync(saved.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await FileSystem.deleteAsync(saved.uri, { idempotent: true });
  return data;
}

/** JPEG base64 sized for the vision request. */
export function toExtractionBase64(uri: string): Promise<string> {
  return downscaleToBase64(uri, EXTRACTION_MAX_EDGE, 0.85);
}

/** JPEG base64 sized for embedding in the PDF report. */
export function toPdfBase64(uri: string): Promise<string> {
  return downscaleToBase64(uri, PDF_MAX_EDGE, 0.7);
}

export async function deleteImage(uri: string): Promise<void> {
  if (!uri.startsWith(RECEIPTS_DIR)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

/**
 * Removes receipt files no row points at any more (crops supersede files, and
 * a deleted expense cascades its rows away). Safe to call at any time.
 */
export async function pruneOrphanedImages(referenced: Set<string>): Promise<number> {
  const info = await FileSystem.getInfoAsync(RECEIPTS_DIR);
  if (!info.exists) return 0;
  const names = await FileSystem.readDirectoryAsync(RECEIPTS_DIR);
  let removed = 0;
  for (const name of names) {
    const uri = `${RECEIPTS_DIR}${name}`;
    if (!referenced.has(uri)) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      removed++;
    }
  }
  return removed;
}
