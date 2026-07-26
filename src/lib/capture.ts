import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';
import { persistCapturedImage, type StoredImage } from './images';

async function ensurePermission(kind: 'camera' | 'library'): Promise<boolean> {
  const result =
    kind === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (result.granted) return true;
  Alert.alert(
    kind === 'camera' ? 'Camera access needed' : 'Photo access needed',
    kind === 'camera'
      ? 'Expender needs the camera to scan receipts.'
      : 'Expender needs photo access to attach receipts you already took.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => void Linking.openSettings() },
    ],
  );
  return false;
}

/**
 * Captures or picks receipt images and copies them into app storage.
 * Returns an empty array when the user cancels — callers must treat that as a
 * no-op and NOT create an empty expense.
 */
export async function captureReceipts(source: 'camera' | 'library'): Promise<StoredImage[]> {
  if (!(await ensurePermission(source === 'camera' ? 'camera' : 'library'))) return [];

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1,
          // Cropping happens in our own editor, against the full-resolution
          // original, so the raw capture is kept intact here.
          allowsEditing: false,
          exif: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 1,
          allowsMultipleSelection: true,
          selectionLimit: 10,
          exif: false,
        });

  if (result.canceled || !result.assets?.length) return [];

  const stored: StoredImage[] = [];
  for (const asset of result.assets) {
    stored.push(await persistCapturedImage(asset.uri));
  }
  return stored;
}
