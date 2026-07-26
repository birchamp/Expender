import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, View, StyleSheet } from 'react-native';
import { getDb } from '@/db';
import { recoverInterruptedJobs } from '@/ai/queue';
import { listAllReceiptUris } from '@/db/expenses';
import { pruneOrphanedImages } from '@/lib/images';
import { colors, spacing } from '@/theme';
import { Loading } from '@/components/ui';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getDb();
        if (cancelled) return;
        setReady(true);

        // Housekeeping that must not block first paint: pick up scans the app
        // was killed mid-flight, and reclaim superseded crop files.
        void recoverInterruptedJobs();
        void (async () => {
          try {
            const referenced = new Set(await listAllReceiptUris());
            await pruneOrphanedImages(referenced);
          } catch {
            // Cleanup is best-effort; never surface it to the user.
          }
        })();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <SafeAreaProvider>
        <View style={styles.fallback}>
          <Text style={styles.fallbackTitle}>Expender could not start</Text>
          <Text style={styles.fallbackBody}>{error}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={styles.fallback}>
          <Loading label="Opening your expense data…" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="trip/new" options={{ title: 'New trip', presentation: 'modal' }} />
        <Stack.Screen name="trip/[id]" options={{ title: 'Trip' }} />
        <Stack.Screen name="trip/edit/[id]" options={{ title: 'Edit trip', presentation: 'modal' }} />
        <Stack.Screen name="expense/[id]" options={{ title: 'Expense' }} />
        <Stack.Screen name="crop/[receiptId]" options={{ title: 'Crop receipt', presentation: 'modal' }} />
        <Stack.Screen name="report/[tripId]" options={{ title: 'Export report', presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  fallbackTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },
  fallbackBody: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
});
