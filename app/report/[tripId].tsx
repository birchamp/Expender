import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button, Card, Divider, Loading, Row, Screen } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { formatMoney } from '@/lib/format';
import { getTrip } from '@/db/trips';
import { listExpenses } from '@/db/expenses';
import { getPreferences, setPreference } from '@/db/settings';
import { generateReportCsv, generateReportPdf, shareFile } from '@/pdf/report';
import type { ExpenseWithReceipts, Trip } from '@/types';

export default function ReportScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [expenses, setExpenses] = useState<ExpenseWithReceipts[] | null>(null);
  const [includeReceipts, setIncludeReceipts] = useState(true);
  const [includeLineItems, setIncludeLineItems] = useState(true);
  const [onlyComplete, setOnlyComplete] = useState(true);
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);

  useEffect(() => {
    if (!tripId) return;
    void (async () => {
      const [t, e, prefs] = await Promise.all([getTrip(tripId), listExpenses(tripId), getPreferences()]);
      setTrip(t);
      setExpenses(e);
      setIncludeReceipts(prefs.includeReceiptsInPdf);
    })();
  }, [tripId]);

  const receiptCount = expenses?.reduce((sum, e) => sum + e.receipts.length, 0) ?? 0;
  const incomplete = expenses?.filter((e) => e.status === 'pending' || e.status === 'failed').length ?? 0;
  const unconfirmed = expenses?.filter((e) => e.status === 'needs_review').length ?? 0;
  const reported = onlyComplete
    ? (expenses ?? []).filter((e) => e.status === 'confirmed' || e.status === 'needs_review')
    : (expenses ?? []);
  const total = reported.reduce((sum, e) => sum + (e.amount ?? 0), 0);

  const exportPdf = useCallback(async () => {
    if (!trip || !expenses) return;
    setBusy('pdf');
    try {
      const result = await generateReportPdf(trip, expenses, {
        includeReceipts,
        includeLineItems,
        onlyComplete,
      });
      await shareFile(result.uri, 'application/pdf', `${trip.name} expense report`);
    } catch (error) {
      Alert.alert('Could not build the report', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [trip, expenses, includeReceipts, includeLineItems, onlyComplete]);

  const exportCsv = useCallback(async () => {
    if (!trip || !expenses) return;
    setBusy('csv');
    try {
      const result = await generateReportCsv(trip, onlyComplete ? reported : expenses);
      await shareFile(result.uri, 'text/csv', `${trip.name} expenses`);
    } catch (error) {
      Alert.alert('Could not build the CSV', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [trip, expenses, reported, onlyComplete]);

  if (!trip || !expenses) return <Loading label="Preparing report…" />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.title}>{trip.name}</Text>
          <Divider />
          <Row label="Expenses in report" value={String(reported.length)} />
          <Row label="Total" value={formatMoney(total, trip.currency)} />
          <Row label="Receipt photos" value={String(receiptCount)} />
          {unconfirmed > 0 ? (
            <Row label="Not yet confirmed" value={String(unconfirmed)} valueColor={colors.warning} />
          ) : null}
          {incomplete > 0 ? (
            <Row
              label={onlyComplete ? 'Excluded (not scanned)' : 'Included but not scanned'}
              value={String(incomplete)}
              valueColor={colors.danger}
            />
          ) : null}
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <ToggleRow
            label="Attach receipts"
            hint="One receipt per page, after the summary table."
            value={includeReceipts}
            onChange={(v) => {
              setIncludeReceipts(v);
              void setPreference('includeReceiptsInPdf', v);
            }}
          />
          <ToggleRow
            label="Show line items"
            hint="Prints what was on each receipt under its description."
            value={includeLineItems}
            onChange={setIncludeLineItems}
          />
          <ToggleRow
            label="Only completed expenses"
            hint="Leaves out anything still scanning or failed, so the totals are real."
            value={onlyComplete}
            onChange={setOnlyComplete}
            last
          />
        </Card>

        {includeReceipts && receiptCount > 12 ? (
          <Text style={styles.note}>
            {receiptCount} receipt images will be embedded. Building this PDF may take a moment.
          </Text>
        ) : null}

        <View style={{ height: spacing.xl }} />
        <Button
          title="Export PDF"
          onPress={exportPdf}
          loading={busy === 'pdf'}
          disabled={busy !== null || reported.length === 0}
        />
        <View style={{ height: spacing.md }} />
        <Button
          title="Export CSV"
          variant="secondary"
          onPress={exportCsv}
          loading={busy === 'csv'}
          disabled={busy !== null || reported.length === 0}
        />
        {reported.length === 0 ? (
          <Text style={styles.note}>There is nothing to export yet.</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  last,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, !last && styles.toggleRowBorder]}>
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={colors.text}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  toggleRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  toggleLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  toggleHint: { color: colors.textFaint, fontSize: 12, marginTop: 2, lineHeight: 17 },
  note: { color: colors.textFaint, fontSize: 12, marginTop: spacing.md, textAlign: 'center', lineHeight: 17 },
});
