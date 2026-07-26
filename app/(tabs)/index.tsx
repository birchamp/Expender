import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Badge, Button, Card, EmptyState, Loading, Screen } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { formatDateRange, formatMoney } from '@/lib/format';
import { getTripTotals, listTrips } from '@/db/trips';
import { subscribeToExtractions } from '@/ai/queue';
import type { Trip, TripTotals } from '@/types';

interface TripRow {
  trip: Trip;
  totals: TripTotals;
}

export default function TripsScreen() {
  const [rows, setRows] = useState<TripRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const trips = await listTrips();
    const totals = await Promise.all(trips.map((trip) => getTripTotals(trip.id)));
    setRows(trips.map((trip, i) => ({ trip, totals: totals[i] })));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = () => {
        void load().catch(() => {
          if (active) setRows([]);
        });
      };
      run();
      // Repaint when a background scan lands while this screen is open.
      const unsubscribe = subscribeToExtractions(run);
      return () => {
        active = false;
        unsubscribe();
      };
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (rows === null) return <Loading label="Loading trips…" />;

  return (
    <Screen>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.trip.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          rows.length ? (
            <Button
              title="+  New trip"
              onPress={() => router.push('/trip/new')}
              style={{ marginBottom: spacing.lg }}
            />
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            title="No trips yet"
            message="A trip holds its description and location, and every receipt you scan into it. That context is what lets Expender work out what each expense was for."
            action={<Button title="Create your first trip" onPress={() => router.push('/trip/new')} />}
          />
        }
        renderItem={({ item }) => <TripCard row={item} />}
      />
    </Screen>
  );
}

function TripCard({ row }: { row: TripRow }) {
  const { trip, totals } = row;
  const attention = totals.needsReview + totals.failed;

  return (
    <Card onPress={() => router.push(`/trip/${trip.id}`)} style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.name} numberOfLines={1}>
          {trip.name}
        </Text>
        <Text style={styles.total}>{formatMoney(totals.total, trip.currency)}</Text>
      </View>

      <Text style={styles.meta} numberOfLines={1}>
        {trip.location ? `${trip.location} · ` : ''}
        {formatDateRange(trip.startDate, trip.endDate)}
      </Text>

      {trip.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {trip.description}
        </Text>
      ) : null}

      <View style={styles.badges}>
        <Badge
          label={`${totals.count} expense${totals.count === 1 ? '' : 's'}`}
          color={colors.textDim}
        />
        {totals.pending > 0 ? <Badge label={`${totals.pending} scanning`} color={colors.accent} /> : null}
        {attention > 0 ? <Badge label={`${attention} need attention`} color={colors.warning} /> : null}
        {trip.status !== 'open' ? <Badge label={trip.status} color={colors.success} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: { marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  name: { color: colors.text, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  total: { color: colors.text, fontSize: 17, fontWeight: '700' },
  meta: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  description: { color: colors.textFaint, fontSize: 13, marginTop: spacing.sm, lineHeight: 18 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
});
