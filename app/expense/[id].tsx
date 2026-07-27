import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, Button, Card, Divider, Field, Input, Loading, Screen } from '@/components/ui';
import { FormScreen } from '@/components/FormScreen';
import { DateField } from '@/components/DateField';
import { colors, radius, spacing, statusColor, statusLabel } from '@/theme';
import { CATEGORIES, CATEGORY_LABELS, type Category, type ExpenseWithReceipts, type Trip } from '@/types';
import { formatMoney, parseAmountInput, roundMoney } from '@/lib/format';
import {
  addReceipt,
  deleteExpense,
  deleteReceipt,
  getExpenseWithReceipts,
  updateExpense,
  updateReceiptImage,
} from '@/db/expenses';
import { getTrip } from '@/db/trips';
import { captureReceipts } from '@/lib/capture';
import { getImageSize } from '@/lib/images';
import { isExtracting, retryExtraction, subscribeToExtractions } from '@/ai/queue';

interface FormState {
  merchant: string;
  date: string | null;
  amount: string;
  currency: string;
  subtotal: string;
  tax: string;
  tip: string;
  category: Category;
  paymentMethod: string;
  description: string;
  businessPurpose: string;
  attendees: string;
  notes: string;
}

function toForm(expense: ExpenseWithReceipts): FormState {
  const money = (n: number | null) => (n === null ? '' : String(n));
  return {
    merchant: expense.merchant,
    date: expense.date,
    amount: money(expense.amount),
    currency: expense.currency,
    subtotal: money(expense.subtotal),
    tax: money(expense.tax),
    tip: money(expense.tip),
    category: expense.category,
    paymentMethod: expense.paymentMethod ?? '',
    description: expense.description,
    businessPurpose: expense.businessPurpose,
    attendees: expense.attendees ?? '',
    notes: expense.notes,
  };
}

export default function ExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [expense, setExpense] = useState<ExpenseWithReceipts | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  // Re-render trigger for the queue's in-memory "currently scanning" set.
  const [, setTick] = useState(0);
  // Mirror of `dirty` readable from callbacks without re-subscribing them.
  const dirtyRef = useRef(false);

  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  const load = useCallback(
    async (resetForm: boolean) => {
      if (!id) return;
      const next = await getExpenseWithReceipts(id);
      setExpense(next);
      if (next) {
        setTrip(await getTrip(next.tripId));
        // Never stomp on text the user is in the middle of typing.
        if (resetForm) setForm(toForm(next));
      }
    },
    [id],
  );

  useFocusEffect(
    useCallback(() => {
      void load(!dirtyRef.current);
      const unsubscribe = subscribeToExtractions(() => {
        setTick((n) => n + 1);
        // A scan landing must never discard half-typed edits.
        void load(!dirtyRef.current);
      });
      return unsubscribe;
    }, [load]),
  );

  const scanning = expense ? isExtracting(expense.id) : false;
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    markDirty(true);
  };

  const derivedMismatch = useMemo(() => {
    if (!form) return null;
    const total = parseAmountInput(form.amount);
    const subtotal = parseAmountInput(form.subtotal);
    if (total === null || subtotal === null) return null;
    const parts = roundMoney(subtotal + (parseAmountInput(form.tax) ?? 0) + (parseAmountInput(form.tip) ?? 0));
    return Math.abs(parts - total) > 0.011 ? parts : null;
  }, [form]);

  const save = useCallback(
    async (nextStatus?: 'confirmed') => {
      if (!expense || !form) return;
      const date = form.date;
      const amount = parseAmountInput(form.amount);
      const code = form.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) {
        Alert.alert('Check the currency', 'Use a three-letter ISO code such as USD, EUR or GBP.');
        return;
      }
      if (nextStatus === 'confirmed') {
        if (amount === null || amount <= 0) {
          Alert.alert('Amount required', 'Enter the total actually paid before confirming.');
          return;
        }
        if (!date) {
          Alert.alert('Date required', 'Enter the transaction date before confirming.');
          return;
        }
        if (!form.merchant.trim()) {
          Alert.alert('Merchant required', 'Enter the merchant before confirming.');
          return;
        }
        if (!form.businessPurpose.trim()) {
          Alert.alert('Business purpose required', 'Every expense on the report needs a business purpose.');
          return;
        }
      }

      setBusy(true);
      try {
        await updateExpense(expense.id, {
          merchant: form.merchant.trim(),
          date,
          amount: amount === null ? null : roundMoney(amount),
          currency: code,
          subtotal: numOrNull(form.subtotal),
          tax: numOrNull(form.tax),
          tip: numOrNull(form.tip),
          category: form.category,
          paymentMethod: form.paymentMethod.trim() || null,
          description: form.description.trim(),
          businessPurpose: form.businessPurpose.trim(),
          attendees: form.attendees.trim() || null,
          notes: form.notes.trim(),
          // Once a human has touched it, a rescan must not overwrite the values.
          edited: true,
          ...(nextStatus ? { status: nextStatus, issues: [] } : {}),
        });
        markDirty(false);
        await load(true);
        if (nextStatus === 'confirmed') router.back();
      } catch (error) {
        Alert.alert('Could not save', error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [expense, form, load, markDirty],
  );

  const addPage = useCallback(
    async (source: 'camera' | 'library') => {
      if (!expense) return;
      setBusy(true);
      try {
        const images = await captureReceipts(source);
        for (const image of images) {
          await addReceipt(expense.id, image.uri, image.uri, image.width, image.height);
        }
        if (images.length) await load(false);
      } finally {
        setBusy(false);
      }
    },
    [expense, load],
  );

  const promptAddPage = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Take photo', 'Choose from library', 'Cancel'], cancelButtonIndex: 2, userInterfaceStyle: 'dark' },
        (index) => {
          if (index === 0) void addPage('camera');
          if (index === 1) void addPage('library');
        },
      );
    } else {
      Alert.alert('Add another page', undefined, [
        { text: 'Take photo', onPress: () => void addPage('camera') },
        { text: 'Choose from library', onPress: () => void addPage('library') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [addPage]);

  const receiptActions = useCallback(
    (receiptId: string, uri: string, originalUri: string) => {
      const canRevert = uri !== originalUri;
      const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
        { text: 'Crop / rotate', onPress: () => router.push(`/crop/${receiptId}`) },
      ];
      if (canRevert) {
        buttons.push({
          text: 'Revert to original',
          onPress: async () => {
            const size = await getImageSize(originalUri);
            await updateReceiptImage(receiptId, originalUri, size?.width ?? null, size?.height ?? null);
            await load(false);
          },
        });
      }
      buttons.push({
        text: 'Delete photo',
        style: 'destructive',
        onPress: async () => {
          await deleteReceipt(receiptId);
          await load(false);
        },
      });
      buttons.push({ text: 'Cancel', style: 'cancel' });
      Alert.alert('Receipt photo', undefined, buttons);
    },
    [load],
  );

  const confirmDelete = useCallback(() => {
    if (!expense) return;
    Alert.alert('Delete this expense?', 'The receipt photos go with it. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(expense.id);
          router.back();
        },
      },
    ]);
  }, [expense]);

  if (!expense || !form) return <Loading label="Loading expense…" />;

  const label =
    expense.status === 'needs_review' && expense.issues.length === 0
      ? 'Ready to confirm'
      : statusLabel[expense.status] ?? expense.status;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: expense.merchant || 'Expense',
          headerRight: () => (
            <Pressable accessibilityLabel="Delete expense" onPress={confirmDelete} hitSlop={12}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          ),
        }}
      />
      <FormScreen>
          {/* ---------------------------- receipts ---------------------------- */}
          <View style={styles.receiptStrip}>
            {expense.receipts.map((receipt, index) => (
              <Pressable
                key={receipt.id}
                onPress={() => router.push(`/crop/${receipt.id}`)}
                onLongPress={() => receiptActions(receipt.id, receipt.uri, receipt.originalUri)}
                style={styles.receiptTile}
              >
                <Image source={{ uri: receipt.uri }} style={styles.receiptImage} resizeMode="cover" />
                {expense.receipts.length > 1 ? (
                  <View style={styles.pageBadge}>
                    <Text style={styles.pageBadgeText}>{index + 1}</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
            <Pressable onPress={promptAddPage} style={[styles.receiptTile, styles.addTile]}>
              <Ionicons name="add" size={26} color={colors.textDim} />
              <Text style={styles.addTileText}>Add page</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>Tap a photo to crop or rotate it. Long-press for more options.</Text>

          {/* ----------------------------- status ----------------------------- */}
          <Card style={styles.statusCard}>
            <View style={styles.statusRow}>
              <Badge
                label={scanning ? 'Scanning…' : label}
                color={scanning ? colors.accent : statusColor[expense.status] ?? colors.textDim}
              />
              {expense.confidence !== null ? (
                <Text style={styles.confidence}>
                  {Math.round(expense.confidence * 100)}% confidence
                  {expense.aiModel ? ` · ${expense.aiModel}` : ''}
                </Text>
              ) : null}
            </View>

            {expense.issues.length > 0 ? (
              <View style={styles.issues}>
                {expense.issues.map((issue, index) => (
                  <View key={index} style={styles.issueRow}>
                    <Ionicons name="alert-circle-outline" size={15} color={colors.warning} />
                    <Text style={styles.issueText}>{issue}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {!scanning ? (
              <Button
                title={expense.status === 'pending' ? 'Scan receipt' : 'Rescan receipt'}
                variant="secondary"
                onPress={async () => {
                  if (expense.edited) {
                    Alert.alert(
                      'Rescan this receipt?',
                      'Your edits are kept — a rescan will only refresh the confidence and review notes.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Rescan', onPress: () => void retryExtraction(expense.id) },
                      ],
                    );
                  } else {
                    await retryExtraction(expense.id);
                  }
                }}
                style={{ marginTop: spacing.md }}
              />
            ) : null}
          </Card>

          {/* ------------------------------ fields ---------------------------- */}
          <Field label="Merchant">
            <Input value={form.merchant} onChangeText={(t) => update('merchant', t)} placeholder="Merchant name" />
          </Field>

          <View style={styles.pairRow}>
            <View style={{ flex: 1.4 }}>
              <DateField
                label="Date"
                value={form.date}
                placeholder="Not read"
                onChange={(next) => update('date', next)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Currency">
                <Input
                  value={form.currency}
                  onChangeText={(t) => update('currency', t.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={3}
                />
              </Field>
            </View>
          </View>

          <Field
            label="Total"
            hint={
              derivedMismatch !== null
                ? `Subtotal + tax + tip comes to ${formatMoney(derivedMismatch, form.currency)}.`
                : undefined
            }
          >
            <Input
              value={form.amount}
              onChangeText={(t) => update('amount', t)}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </Field>

          <View style={styles.tripleRow}>
            <View style={{ flex: 1 }}>
              <Field label="Subtotal">
                <Input
                  value={form.subtotal}
                  onChangeText={(t) => update('subtotal', t)}
                  keyboardType="decimal-pad"
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Tax">
                <Input value={form.tax} onChangeText={(t) => update('tax', t)} keyboardType="decimal-pad" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Tip">
                <Input value={form.tip} onChangeText={(t) => update('tip', t)} keyboardType="decimal-pad" />
              </Field>
            </View>
          </View>

          <Field label="Category">
            <View style={styles.chips}>
              {CATEGORIES.map((category) => {
                const active = form.category === category;
                return (
                  <Pressable
                    key={category}
                    onPress={() => update('category', category)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {CATEGORY_LABELS[category]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          <Field label="What was purchased" hint="Appears in the report's description column.">
            <Input
              value={form.description}
              onChangeText={(t) => update('description', t)}
              placeholder="Dinner for three at an Italian restaurant"
              multiline
            />
          </Field>

          <Field
            label="Business purpose"
            hint={trip ? `Grounded in "${trip.name}".` : undefined}
          >
            <Input
              value={form.businessPurpose}
              onChangeText={(t) => update('businessPurpose', t)}
              placeholder="Working dinner with the Nordwind implementation team during the migration workshop."
              multiline
            />
          </Field>

          <Field label="Attendees">
            <Input
              value={form.attendees}
              onChangeText={(t) => update('attendees', t)}
              placeholder="Optional — for meals and entertainment"
            />
          </Field>

          <Field label="Payment method">
            <Input
              value={form.paymentMethod}
              onChangeText={(t) => update('paymentMethod', t)}
              placeholder="Visa ••1234"
            />
          </Field>

          <Field label="Notes">
            <Input value={form.notes} onChangeText={(t) => update('notes', t)} multiline />
          </Field>

          {expense.lineItems.length > 0 ? (
            <>
              <Divider />
              <Text style={styles.sectionTitle}>Line items read from the receipt</Text>
              {expense.lineItems.map((item) => (
                <View key={item.id} style={styles.lineItem}>
                  <Text style={styles.lineItemText} numberOfLines={2}>
                    {item.quantity ? `${item.quantity}× ` : ''}
                    {item.description}
                  </Text>
                  <Text style={styles.lineItemAmount}>{formatMoney(item.amount, form.currency)}</Text>
                </View>
              ))}
            </>
          ) : null}

          <Divider />

          <Button
            title={dirty ? 'Save changes' : 'Saved'}
            variant="secondary"
            onPress={() => void save()}
            disabled={!dirty}
            loading={busy}
          />
          <View style={{ height: spacing.md }} />
          <Button
            title={expense.status === 'confirmed' ? 'Save & keep confirmed' : 'Confirm expense'}
            onPress={() => void save('confirmed')}
            loading={busy}
          />
      </FormScreen>
    </Screen>
  );
}

function numOrNull(value: string): number | null {
  const parsed = parseAmountInput(value);
  return parsed === null ? null : roundMoney(parsed);
}

const styles = StyleSheet.create({
  receiptStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  receiptTile: {
    width: 96,
    height: 128,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  receiptImage: { width: '100%', height: '100%' },
  addTile: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', gap: 4 },
  addTileText: { color: colors.textDim, fontSize: 12 },
  pageBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  pageBadgeText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  hint: { color: colors.textFaint, fontSize: 12, marginTop: spacing.sm, marginBottom: spacing.lg },
  statusCard: { marginBottom: spacing.xl, padding: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  confidence: { color: colors.textFaint, fontSize: 11, flexShrink: 1, textAlign: 'right' },
  issues: { marginTop: spacing.md, gap: 6 },
  issueRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  issueText: { color: colors.textDim, fontSize: 13, flex: 1, lineHeight: 18 },
  pairRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg, alignItems: 'flex-start' },
  tripleRow: { flexDirection: 'row', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13 },
  chipTextActive: { color: colors.text, fontWeight: '600' },
  sectionTitle: { color: colors.textDim, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm },
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineItemText: { color: colors.textDim, fontSize: 13, flex: 1 },
  lineItemAmount: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
