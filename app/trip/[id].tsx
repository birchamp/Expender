import React, { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, Button, Card, EmptyState, Loading, Screen } from '@/components/ui';
import { ExpenseCard } from '@/components/ExpenseCard';
import { colors, radius, spacing } from '@/theme';
import { CATEGORY_LABELS, type ExpenseWithReceipts, type Trip, type TripTotals } from '@/types';
import { formatDateRange, formatMoney } from '@/lib/format';
import { getTrip, getTripTotals } from '@/db/trips';
import { addReceipt, createPendingExpense, listExpenses } from '@/db/expenses';
import { captureReceipts } from '@/lib/capture';
import { enqueueExtraction, isExtracting, subscribeToExtractions } from '@/ai/queue';
import { getApiKey } from '@/db/settings';

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [expenses, setExpenses] = useState<ExpenseWithReceipts[] | null>(null);
  const [totals, setTotals] = useState<TripTotals | null>(null);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    const [t, e, s] = await Promise.all([getTrip(id), listExpenses(id), getTripTotals(id)]);
    setTrip(t);
    setExpenses(e);
    setTotals(s);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      const run = () => {
        void load();
        setTick((n) => n + 1);
      };
      run();
      const unsubscribe = subscribeToExtractions(run);
      return unsubscribe;
    }, [load]),
  );

  const addFrom = useCallback(
    async (source: 'camera' | 'library') => {
      if (!trip) return;
      setAdding(true);
      try {
        const images = await captureReceipts(source);
        if (!images.length) return;

        // One expense per image. Multi-page receipts are merged from the
        // expense screen, where the user can see what they're grouping.
        let firstId: string | null = null;
        for (const image of images) {
          const expense = await createPendingExpense(trip.id, trip.currency);
          await addReceipt(expense.id, image.uri, image.uri, image.width, image.height);
          await enqueueExtraction(expense.id);
          firstId = firstId ?? expense.id;
        }
        await load();

        if (!(await getApiKey())) {
          Alert.alert(
            'Receipt saved — scanning is off',
            'No Anthropic API key is set, so Expender cannot read this receipt yet. Add a key in Settings, then tap Retry scan on the expense.',
          );
        } else if (images.length === 1 && firstId) {
          router.push(`/expense/${firstId}`);
        }
      } catch (error) {
        Alert.alert('Could not add receipt', error instanceof Error ? error.message : String(error));
      } finally {
        setAdding(false);
      }
    },
    [trip, load],
  );

  const promptAdd = useCallback(() => {
    const options = ['Take photo', 'Choose from library', 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 2, userInterfaceStyle: 'dark' },
        (index) => {
          if (index === 0) void addFrom('camera');
          if (index === 1) void addFrom('library');
        },
      );
    } else {
      Alert.alert('Add receipt', undefined, [
        { text: 'Take photo', onPress: () => void addFrom('camera') },
        { text: 'Choose from library', onPress: () => void addFrom('library') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [addFrom]);

  if (!trip || !expenses || !totals) return <Loading label="Loading trip…" />;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: trip.name,
          headerRight: () => (
            <Pressable
              accessibilityLabel="Edit trip"
              onPress={() => router.push(`/trip/edit/${trip.id}`)}
              hitSlop={12}
            >
              <Ionicons name="create-outline" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      <FlatList
        data={expenses}
        keyExtractor={(expense) => expense.id}
        // `tick` bumps on every queue notification so rows re-read the
        // in-memory "currently scanning" set.
        extraData={tick}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <TripHeader trip={trip} totals={totals} onExport={() => router.push(`/report/${trip.id}`)} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No receipts yet"
            message="Scan a receipt and Expender reads the merchant, date and amount off the paper, then works out what it was for from this trip's description."
          />
        }
        renderItem={({ item }) => (
          <ExpenseCard
            expense={item}
            scanning={isExtracting(item.id)}
            onPress={() => router.push(`/expense/${item.id}`)}
          />
        )}
      />

      <View style={styles.fabBar}>
        <Button title="＋  Scan receipt" onPress={promptAdd} loading={adding} />
      </View>
    </Screen>
  );
}

function TripHeader({
  trip,
  totals,
  onExport,
}: {
  trip: Trip;
  totals: TripTotals;
  onExport: () => void;
}) {
  const attention = totals.needsReview + totals.failed;
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Card style={{ marginBottom: spacing.md }}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{formatMoney(totals.total, trip.currency)}</Text>
        <Text style={styles.meta}>
          {trip.location ? `${trip.location} · ` : ''}
          {formatDateRange(trip.startDate, trip.endDate)}
        </Text>
        {trip.description ? <Text style={styles.description}>{trip.description}</Text> : null}

        <View style={styles.badges}>
          <Badge label={`${totals.count} expense${totals.count === 1 ? '' : 's'}`} color={colors.textDim} />
          {totals.pending > 0 ? <Badge label={`${totals.pending} scanning`} color={colors.accent} /> : null}
          {attention > 0 ? <Badge label={`${attention} need attention`} color={colors.warning} /> : null}
        </View>

        {totals.byCategory.length > 1 ? (
          <View style={styles.categoryList}>
            {totals.byCategory.slice(0, 5).map((entry) => (
              <View key={entry.category} style={styles.categoryRow}>
                <Text style={styles.categoryName}>{CATEGORY_LABELS[entry.category]}</Text>
                <Text style={styles.categoryValue}>{formatMoney(entry.total, trip.currency)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Button title="Export report" variant="secondary" onPress={onExport} style={{ marginTop: spacing.lg }} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: 96 },
  totalLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  totalValue: { color: colors.text, fontSize: 32, fontWeight: '800', marginTop: 2 },
  meta: { color: colors.textDim, fontSize: 13, marginTop: spacing.sm },
  description: { color: colors.textFaint, fontSize: 13, marginTop: spacing.sm, lineHeight: 18 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  categoryList: {
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: 6,
  },
  categoryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  categoryName: { color: colors.textDim, fontSize: 13 },
  categoryValue: { color: colors.text, fontSize: 13, fontWeight: '600' },
  fabBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
});
