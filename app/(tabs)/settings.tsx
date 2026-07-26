import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card, Divider, Field, Input, Loading, Screen } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import {
  AVAILABLE_MODELS,
  DEFAULT_PREFERENCES,
  getApiKey,
  getPreferences,
  maskApiKey,
  setApiKey,
  setPreference,
  type AppPreferences,
} from '@/db/settings';
import { invalidateClient } from '@/ai/client';
import { listAllReceiptUris } from '@/db/expenses';
import { pruneOrphanedImages } from '@/lib/images';

const EFFORTS: AppPreferences['effort'][] = ['low', 'medium', 'high'];

export default function SettingsScreen() {
  const [prefs, setPrefs] = useState<AppPreferences | null>(null);
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [p, k] = await Promise.all([getPreferences(), getApiKey()]);
    setPrefs(p);
    setStoredKey(k);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const change = useCallback(
    async <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
      setPrefs((p) => (p ? { ...p, [key]: value } : p));
      await setPreference(key, value);
    },
    [],
  );

  const commitKey = useCallback(
    async (value: string) => {
      setBusy(true);
      try {
        await setApiKey(value);
        invalidateClient();
        setKeyDraft('');
        setEditingKey(false);
        await reload();
      } catch (error) {
        Alert.alert('Could not save the key', error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const saveKey = useCallback(async () => {
    const trimmed = keyDraft.trim();
    if (trimmed && !trimmed.startsWith('sk-ant-')) {
      Alert.alert(
        'That does not look like an Anthropic key',
        'Anthropic API keys start with "sk-ant-". Save it anyway?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save anyway', onPress: () => void commitKey(trimmed) },
        ],
      );
      return;
    }
    await commitKey(trimmed);
  }, [keyDraft, commitKey]);

  const cleanUp = useCallback(async () => {
    setBusy(true);
    try {
      const referenced = new Set(await listAllReceiptUris());
      const removed = await pruneOrphanedImages(referenced);
      Alert.alert(
        'Storage cleaned',
        removed === 0
          ? 'Nothing to remove — every stored image is still attached to an expense.'
          : `Removed ${removed} unused image file${removed === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      Alert.alert('Could not clean up', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!prefs) return <Loading label="Loading settings…" />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {/* ------------------------------ API key ----------------------------- */}
        <Text style={styles.sectionTitle}>Receipt scanning</Text>
        <Card>
          <Text style={styles.cardTitle}>Anthropic API key</Text>
          <Text style={styles.cardBody}>
            Receipt scanning calls the Claude API directly from this device. The key is stored in the
            system keychain and is never sent anywhere except api.anthropic.com.
          </Text>

          {editingKey ? (
            <>
              <Input
                value={keyDraft}
                onChangeText={setKeyDraft}
                placeholder="sk-ant-…"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={{ marginTop: spacing.md }}
              />
              <View style={styles.buttonRow}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setEditingKey(false);
                    setKeyDraft('');
                  }}
                  style={{ flex: 1 }}
                />
                <Button title="Save key" onPress={saveKey} loading={busy} style={{ flex: 1 }} />
              </View>
            </>
          ) : (
            <>
              <View style={styles.keyRow}>
                <Text style={styles.keyValue}>{maskApiKey(storedKey)}</Text>
              </View>
              <View style={styles.buttonRow}>
                <Button
                  title={storedKey ? 'Replace' : 'Add key'}
                  variant="secondary"
                  onPress={() => setEditingKey(true)}
                  style={{ flex: 1 }}
                />
                {storedKey ? (
                  <Button
                    title="Remove"
                    variant="danger"
                    onPress={() =>
                      Alert.alert('Remove the API key?', 'Scanning will stop until you add one again.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: () => void commitKey('') },
                      ])
                    }
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
              <Pressable onPress={() => void Linking.openURL('https://console.anthropic.com/settings/keys')}>
                <Text style={styles.link}>Get a key at console.anthropic.com →</Text>
              </Pressable>
            </>
          )}
        </Card>

        {/* ------------------------------- model ------------------------------ */}
        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.cardTitle}>Model</Text>
          {AVAILABLE_MODELS.map((model) => {
            const active = prefs.model === model.id;
            return (
              <Pressable
                key={model.id}
                onPress={() => void change('model', model.id)}
                style={[styles.option, active && styles.optionActive]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionLabel, active && { color: colors.text }]}>{model.label}</Text>
                  <Text style={styles.optionNote}>{model.note}</Text>
                </View>
                {active ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            );
          })}

          <Divider />
          <Text style={styles.cardTitle}>Reading effort</Text>
          <Text style={styles.cardBody}>
            Higher effort means the model looks harder at faint or crumpled receipts, at more cost per
            scan. Medium handles almost everything.
          </Text>
          <View style={styles.chips}>
            {EFFORTS.map((effort) => {
              const active = prefs.effort === effort;
              return (
                <Pressable
                  key={effort}
                  onPress={() => void change('effort', effort)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{effort}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* ----------------------------- behaviour ---------------------------- */}
        <Text style={styles.sectionTitle}>Review</Text>
        <Card>
          <View style={[styles.toggleRow, styles.toggleRowBorder]}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={styles.optionLabel}>Auto-confirm clean scans</Text>
              <Text style={styles.optionNote}>
                Skip review when every arithmetic and date check passes and confidence is above your
                threshold. Off by default — an expense report is your signature, not the model's.
              </Text>
            </View>
            <Switch
              value={prefs.autoConfirmHighConfidence}
              onValueChange={(v) => void change('autoConfirmHighConfidence', v)}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.text}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={styles.optionLabel}>Attach receipts to PDFs by default</Text>
              <Text style={styles.optionNote}>One receipt image per page after the summary table.</Text>
            </View>
            <Switch
              value={prefs.includeReceiptsInPdf}
              onValueChange={(v) => void change('includeReceiptsInPdf', v)}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.text}
            />
          </View>

          <Divider />
          <Field
            label="Confidence threshold"
            hint={`Scans below ${Math.round(prefs.confidenceThreshold * 100)}% are always flagged for review.`}
          >
            <View style={styles.chips}>
              {[0.6, 0.7, 0.8, 0.9].map((value) => {
                const active = Math.abs(prefs.confidenceThreshold - value) < 0.001;
                return (
                  <Pressable
                    key={value}
                    onPress={() => void change('confidenceThreshold', value)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {Math.round(value * 100)}%
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>
        </Card>

        {/* ------------------------------ defaults ---------------------------- */}
        <Text style={styles.sectionTitle}>Defaults</Text>
        <Card>
          <Field label="Default currency for new trips">
            <Input
              value={prefs.defaultCurrency}
              onChangeText={(t) => {
                const code = t.toUpperCase().slice(0, 3);
                void change('defaultCurrency', code);
              }}
              autoCapitalize="characters"
              maxLength={3}
              placeholder={DEFAULT_PREFERENCES.defaultCurrency}
            />
          </Field>
          <Button title="Clean up unused images" variant="secondary" onPress={cleanUp} loading={busy} />
        </Card>

        <Text style={styles.footer}>
          All trips, expenses and receipt photos stay on this device. Nothing is uploaded except the
          receipt image and trip description sent to the Claude API when you scan.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  cardBody: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  keyRow: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  keyValue: { color: colors.text, fontSize: 14, fontFamily: 'monospace' },
  buttonRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  link: { color: colors.accent, fontSize: 13, marginTop: spacing.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionActive: {},
  optionLabel: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  optionNote: { color: colors.textFaint, fontSize: 12, marginTop: 2, lineHeight: 17 },
  check: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: colors.text, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  toggleRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  footer: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});
