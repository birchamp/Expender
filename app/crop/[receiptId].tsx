import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Loading, Screen } from '@/components/ui';
import { CropEditor } from '@/components/CropEditor';
import { colors, spacing } from '@/theme';
import { getReceipt, updateReceiptImage } from '@/db/expenses';
import { cropImage, getImageSize, rotateImage, type CropRect } from '@/lib/images';
import type { Receipt } from '@/types';

export default function CropScreen() {
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  /** The image currently on screen. Rotations are applied eagerly so the
   *  editor is WYSIWYG; the file only becomes the receipt's on save. */
  const [working, setWorking] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const cropRef = useRef<CropRect | null>(null);

  useEffect(() => {
    if (!receiptId) return;
    void (async () => {
      const r = await getReceipt(receiptId);
      if (!r) return;
      setReceipt(r);
      const size =
        r.width && r.height ? { width: r.width, height: r.height } : await getImageSize(r.uri);
      if (size) setWorking({ uri: r.uri, width: size.width, height: size.height });
    })();
  }, [receiptId]);

  const rotate = useCallback(async () => {
    if (!working) return;
    setBusy(true);
    try {
      const rotated = await rotateImage(working.uri);
      const size =
        rotated.width && rotated.height
          ? { width: rotated.width, height: rotated.height }
          : await getImageSize(rotated.uri);
      if (!size) throw new Error('Could not read the rotated image.');
      cropRef.current = null;
      setWorking({ uri: rotated.uri, width: size.width, height: size.height });
      setChanged(true);
    } catch (error) {
      Alert.alert('Could not rotate', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [working]);

  const revert = useCallback(async () => {
    if (!receipt) return;
    const size = await getImageSize(receipt.originalUri);
    if (!size) return;
    cropRef.current = null;
    setWorking({ uri: receipt.originalUri, width: size.width, height: size.height });
    setChanged(receipt.uri !== receipt.originalUri);
  }, [receipt]);

  const save = useCallback(async () => {
    if (!receipt || !working) return;
    setBusy(true);
    try {
      let finalUri = working.uri;
      let finalSize: { width: number; height: number } | null = {
        width: working.width,
        height: working.height,
      };
      if (cropRef.current) {
        const cropped = await cropImage(working.uri, cropRef.current);
        finalUri = cropped.uri;
        finalSize =
          cropped.width && cropped.height
            ? { width: cropped.width, height: cropped.height }
            : await getImageSize(cropped.uri);
      }
      await updateReceiptImage(receipt.id, finalUri, finalSize?.width ?? null, finalSize?.height ?? null);
      router.back();
    } catch (error) {
      Alert.alert('Could not save the crop', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [receipt, working]);

  if (!receipt || !working) return <Loading label="Opening receipt…" />;

  const dirty = changed || cropRef.current !== null;

  return (
    <Screen>
      <View style={styles.editor}>
        <CropEditor
          uri={working.uri}
          imageWidth={working.width}
          imageHeight={working.height}
          onCropChange={(crop) => {
            cropRef.current = crop;
            setChanged(true);
          }}
        />
      </View>

      <View style={styles.toolbar}>
        <Text style={styles.hint}>
          Drag the corners to trim the receipt. Cropping tightly to the paper measurably improves what
          Expender can read off it.
        </Text>
        <View style={styles.buttonRow}>
          <Button title="Rotate 90°" variant="secondary" onPress={rotate} disabled={busy} style={styles.flexButton} />
          <Button
            title="Revert"
            variant="secondary"
            onPress={revert}
            disabled={busy || (working.uri === receipt.originalUri && !dirty)}
            style={styles.flexButton}
          />
        </View>
        <Button title="Save receipt" onPress={save} loading={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  editor: { flex: 1 },
  toolbar: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    gap: spacing.md,
  },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  buttonRow: { flexDirection: 'row', gap: spacing.md },
  flexButton: { flex: 1 },
});
