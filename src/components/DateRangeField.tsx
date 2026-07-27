import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DateField } from './DateField';
import { colors, spacing } from '@/theme';
import { parseISODate } from '@/lib/format';

/**
 * Start/end pair that cannot produce an invalid range: each picker is bounded
 * by the other, so "end before start" is unreachable rather than validated
 * after the fact.
 */
export function DateRangeField({
  startDate,
  endDate,
  onChange,
  hint,
}: {
  startDate: string | null;
  endDate: string | null;
  onChange: (next: { startDate: string | null; endDate: string | null }) => void;
  hint?: string;
}) {
  const start = startDate ? parseISODate(startDate) : null;
  const end = endDate ? parseISODate(endDate) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <DateField
          label="Start date"
          value={startDate}
          maximumDate={end ?? undefined}
          onChange={(next) => {
            // Dragging the start past the end drags the end along rather than
            // silently rejecting the tap.
            const nextStart = next ? parseISODate(next) : null;
            const pushEnd = nextStart && end && nextStart.getTime() > end.getTime();
            onChange({ startDate: next, endDate: pushEnd ? next : endDate });
          }}
        />
        <DateField
          label="End date"
          value={endDate}
          minimumDate={start ?? undefined}
          onChange={(next) => onChange({ startDate, endDate: next })}
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md },
  hint: { color: colors.textFaint, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
});
