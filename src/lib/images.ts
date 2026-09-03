import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image, Platform } from 'react-native';
import { newId } from './id';

/**
 * expo-file-system's `File`/`Directory` classes have no web implementation —
 * the web build is a stub whose constructor only logs a warning, so any
 * operation on it fails. Receipt capture therefore cannot work in a browser.
 */
export class FileStorageUnavailableError extends Error {
  constructor() {
    super('Receipt photos need device storage, which the browser build does not have. Open the app in Expo Go on your phone.');
    this.name = 'FileStorageUnavailableError';
  }
}

export const fileStorageAvailable = Platform.OS !== 'web';

/**
 * Receipt images live here permanently, outside the OS-reclaimable cache.
 *
 * Resolved lazily and never at module scope: this module is imported by the
 * extraction queue, which most screens pull in transitively, so a throwing
 * constructor at import time white-screens the entire app instead of failing
 * the one feature that needs storage.
 */
let cachedDir: Directory | null = null;

function receiptsDir(): Directory {
  if (!fileStorageAvailable) throw new FileStorageUnavailableError();
  if (!cachedDir) cachedDir = new Directory(Paths.document, 'receipts');
  return cachedDir;
}

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

function ensureDir(): Directory {
  const dir = receiptsDir();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
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
  const dir = ensureDir();
  const target = new File(dir, `${newId('r_')}.jpg`);
  await new File(sourceUri).copy(target);
  const size = await getImageSize(target.uri);
  return { uri: target.uri, width: size?.width ?? null, height: size?.height ?? null };
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
  const dir = ensureDir();
  const context = ImageManipulator.manipulate(sourceUri);
  apply(context);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });

  const target = new File(dir, `${newId('r_')}.jpg`);
  await new File(saved.uri).move(target);
  const size = await getImageSize(target.uri);
  return { uri: target.uri, width: size?.width ?? null, height: size?.height ?? null };
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
  if (!fileStorageAvailable) throw new FileStorageUnavailableError();
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

  // The manipulator writes a temp file even when base64 is requested.
  const temp = new File(saved.uri);
  const data = saved.base64 ?? (await temp.base64());
  if (temp.exists) temp.delete();
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

export function deleteImage(uri: string): void {
  if (!fileStorageAvailable) return;
  if (!uri.startsWith(receiptsDir().uri)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

/**
 * Removes receipt files no row points at any more (crops supersede files, and
 * a deleted expense cascades its rows away). Safe to call at any time.
 */
export function pruneOrphanedImages(referenced: Set<string>): number {
  if (!fileStorageAvailable) return 0;
  const dir = receiptsDir();
  if (!dir.exists) return 0;
  let removed = 0;
  for (const entry of dir.list()) {
    if (entry instanceof Directory) continue;
    if (!referenced.has(entry.uri)) {
      entry.delete();
      removed++;
    }
  }
  return removed;
}
