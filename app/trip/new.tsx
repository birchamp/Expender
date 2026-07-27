import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Button, Field, Input } from '@/components/ui';
import { FormScreen } from '@/components/FormScreen';
import { DateRangeField } from '@/components/DateRangeField';
import { colors, spacing } from '@/theme';
import { createTrip } from '@/db/trips';
import { getPreferences } from '@/db/settings';
import { todayISO } from '@/lib/format';

export default function NewTripScreen() {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState<string | null>(todayISO());
  const [endDate, setEndDate] = useState<string | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getPreferences().then((prefs) => setCurrency(prefs.defaultCurrency));
  }, []);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give the trip a name so you can find it later.');
      return;
    }
    // Dates come from bounded pickers, so an invalid or reversed range is
    // unreachable here — no parsing or ordering check needed.
    const code = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      Alert.alert('Check the currency', 'Use a three-letter ISO code such as USD, EUR or GBP.');
      return;
    }

    setSaving(true);
    try {
      const trip = await createTrip({
        name: name.trim(),
        description: description.trim(),
        location: location.trim(),
        startDate,
        endDate,
        currency: code,
        purpose: purpose.trim(),
      });
      router.replace(`/trip/${trip.id}`);
    } catch (error) {
      Alert.alert('Could not create trip', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormScreen>
      <Text style={styles.intro}>
        The description and location below are sent with every receipt you scan. The more concrete
        they are, the better the business purpose Expender writes for each expense.
      </Text>

      <Field label="Trip name">
        <Input value={name} onChangeText={setName} placeholder="Q1 client visit — Berlin" autoFocus />
      </Field>

      <Field label="Location">
        <Input value={location} onChangeText={setLocation} placeholder="Berlin, Germany" />
      </Field>

      <Field
        label="What is this trip?"
        hint="Who you're meeting, what you're doing there, why it matters."
      >
        <Input
          value={description}
          onChangeText={setDescription}
          placeholder="Three days on site with Nordwind GmbH to run the migration workshop and close the renewal."
          multiline
        />
      </Field>

      <Field label="Stated business purpose" hint="Optional. Used verbatim on the report header.">
        <Input
          value={purpose}
          onChangeText={setPurpose}
          placeholder="Customer implementation support and contract renewal"
          multiline
        />
      </Field>

      <DateRangeField
        startDate={startDate}
        endDate={endDate}
        onChange={({ startDate: s, endDate: e }) => {
          setStartDate(s);
          setEndDate(e);
        }}
        hint="Travel days themselves. Flights booked weeks earlier and the ride home afterwards still belong to this trip — Expender expects receipts outside these dates."
      />

      <Field label="Reporting currency" hint="Expenses charged in another currency are flagged, not converted.">
        <Input
          value={currency}
          onChangeText={(t) => setCurrency(t.toUpperCase())}
          placeholder="USD"
          autoCapitalize="characters"
          maxLength={3}
        />
      </Field>

      <Button title="Create trip" onPress={save} loading={saving} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: spacing.xl },
});
