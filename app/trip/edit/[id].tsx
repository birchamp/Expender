import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Divider, Field, Input, Loading } from '@/components/ui';
import { FormScreen } from '@/components/FormScreen';
import { DateRangeField } from '@/components/DateRangeField';
import { colors, spacing } from '@/theme';
import { deleteTrip, getTrip, updateTrip } from '@/db/trips';
import type { Trip, TripStatus } from '@/types';

const STATUSES: TripStatus[] = ['open', 'submitted', 'closed'];

export default function EditTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
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
      setStartDate(t.startDate);
      setEndDate(t.endDate);
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
    // Dates come from bounded pickers — nothing to parse or re-order here.
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
        startDate,
        endDate,
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
    <FormScreen>
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

      <DateRangeField
        startDate={startDate}
        endDate={endDate}
        onChange={({ startDate: s, endDate: e }) => {
          setStartDate(s);
          setEndDate(e);
        }}
        hint="Changing these changes which receipt dates Expender considers normal for this trip."
      />

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
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, minHeight: 40, paddingHorizontal: spacing.sm },
  dangerNote: { color: colors.textFaint, fontSize: 12, marginBottom: spacing.md, lineHeight: 17 },
});
