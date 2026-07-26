import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Badge, Card } from './ui';
import { colors, radius, spacing, statusColor, statusLabel } from '@/theme';
import { formatDate, formatMoney } from '@/lib/format';
import { CATEGORY_LABELS, type ExpenseWithReceipts } from '@/types';

export function ExpenseCard({
  expense,
  scanning,
  onPress,
}: {
  expense: ExpenseWithReceipts;
  scanning: boolean;
  onPress: () => void;
}) {
  const thumb = expense.receipts[0]?.uri;
  // "Needs review" with nothing actually wrong just means "a human hasn't
  // signed off yet" — say that instead of implying a problem.
  const label =
    expense.status === 'needs_review' && expense.issues.length === 0
      ? 'Ready to confirm'
      : statusLabel[expense.status] ?? expense.status;
  const color = statusColor[expense.status] ?? colors.textDim;

  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.thumbWrap}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Text style={styles.thumbEmptyText}>No photo</Text>
          </View>
        )}
        {scanning ? (
          <View style={styles.thumbOverlay}>
            <ActivityIndicator color={colors.accent} size="small" />
          </View>
        ) : null}
        {expense.receipts.length > 1 ? (
          <View style={styles.pageCount}>
            <Text style={styles.pageCountText}>{expense.receipts.length}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.merchant} numberOfLines={1}>
            {expense.merchant || (scanning ? 'Reading receipt…' : 'Untitled expense')}
          </Text>
          <Text style={styles.amount}>{formatMoney(expense.amount, expense.currency)}</Text>
        </View>

        <Text style={styles.meta} numberOfLines={1}>
          {formatDate(expense.date)} · {CATEGORY_LABELS[expense.category]}
        </Text>

        {expense.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {expense.description}
          </Text>
        ) : null}

        <View style={styles.footerRow}>
          <Badge label={scanning ? 'Scanning…' : label} color={scanning ? colors.accent : color} />
          {expense.issues.length > 0 ? (
            <Text style={styles.issueCount} numberOfLines={1}>
              {expense.issues.length} to check
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, marginBottom: spacing.md },
  thumbWrap: { width: 68, height: 84 },
  thumb: { width: 68, height: 84, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumbEmptyText: { color: colors.textFaint, fontSize: 10 },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageCount: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pageCountText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  body: { flex: 1, justifyContent: 'space-between' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  merchant: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  amount: { color: colors.text, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  description: { color: colors.textFaint, fontSize: 12, marginTop: 4, lineHeight: 16 },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  issueCount: { color: colors.warning, fontSize: 11, fontWeight: '600' },
});
