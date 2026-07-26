import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Divider, Field, Input, Loading, Screen } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { deleteTrip, getTrip, updateTrip } from '@/db/trips';
import { normaliseDateInput } from '@/lib/format';
import type { Trip, TripStatus } from '@/types';

const STATUSES: TripStatus[] = ['open', 'submitted', 'closed'];

export default function EditTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [status, setStatus] = useState<TripStatus>('open');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getTrip(id).then((t) => {
      if (!t) return;
      setTrip(t);
      setName(t.name);
      setLocation(t.location);
      setDescription(t.description);
      setPurpose(t.purpose);
      setStartDate(t.startDate ?? '');
      setEndDate(t.endDate ?? '');
      setCurrency(t.currency);
      setStatus(t.status);
    });
  }, [id]);

  const save = async () => {
    if (!trip) return;
    if (!name.trim()) {
      Alert.alert('Name required', 'Give the trip a name so you can find it later.');
      return;
    }
    const start = startDate.trim() ? normaliseDateInput(startDate) : null;
    const end = endDate.trim() ? normaliseDateInput(endDate) : null;
    if ((startDate.trim() && !start) || (endDate.trim() && !end)) {
      Alert.alert('Check the dates', 'Use YYYY-MM-DD, e.g. 2026-03-14.');
      return;
    }
    const code = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      Alert.alert('Check the currency', 'Use a three-letter ISO code such as USD, EUR or GBP.');
      return;
    }
    setSaving(true);
    try {
      await updateTrip(trip.id, {
        name: name.trim(),
        location: location.trim(),
        description: description.trim(),
        purpose: purpose.trim(),
        startDate: start,
        endDate: end,
        currency: code,
        status,
      });
      router.back();
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!trip) return;
    Alert.alert(
      'Delete this trip?',
      'Every expense and receipt photo in it is deleted too. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTrip(trip.id);
            router.dismissAll();
            router.replace('/');
          },
        },
      ],
    );
  };

  if (!trip) return <Loading label="Loading trip…" />;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Field label="Trip name">
            <Input value={name} onChangeText={setName} />
          </Field>
          <Field label="Location">
            <Input value={location} onChangeText={setLocation} />
          </Field>
          <Field
            label="What is this trip?"
            hint="Changing this affects the business purpose written for receipts you scan from now on."
          >
            <Input value={description} onChangeText={setDescription} multiline />
          </Field>
          <Field label="Stated business purpose">
            <Input value={purpose} onChangeText={setPurpose} multiline />
          </Field>

          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <Field label="Start date">
                <Input value={startDate} onChangeText={setStartDate} autoCapitalize="none" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="End date">
                <Input value={endDate} onChangeText={setEndDate} autoCapitalize="none" />
              </Field>
            </View>
          </View>

          <Field label="Reporting currency">
            <Input
              value={currency}
              onChangeText={(t) => setCurrency(t.toUpperCase())}
              autoCapitalize="characters"
              maxLength={3}
            />
          </Field>

          <Field label="Status">
            <View style={styles.chips}>
              {STATUSES.map((option) => (
                <Button
                  key={option}
                  title={option}
                  variant={status === option ? 'primary' : 'secondary'}
                  onPress={() => setStatus(option)}
                  style={styles.chip}
                />
              ))}
            </View>
          </Field>

          <Button title="Save changes" onPress={save} loading={saving} />

          <Divider />
          <Text style={styles.dangerNote}>
            Deleting removes the trip, its expenses and their receipt photos from this device.
          </Text>
          <Button title="Delete trip" variant="danger" onPress={confirmDelete} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  dateRow: { flexDirection: 'row', gap: spacing.md },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, minHeight: 40, paddingHorizontal: spacing.sm },
  dangerNote: { color: colors.textFaint, fontSize: 12, marginBottom: spacing.md, lineHeight: 17 },
});
