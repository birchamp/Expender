import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Field, Input, Screen } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { createTrip } from '@/db/trips';
import { getPreferences } from '@/db/settings';
import { normaliseDateInput, todayISO } from '@/lib/format';

export default function NewTripScreen() {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
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
    const start = startDate.trim() ? normaliseDateInput(startDate) : null;
    const end = endDate.trim() ? normaliseDateInput(endDate) : null;
    if (startDate.trim() && !start) {
      Alert.alert('Check the start date', 'Use YYYY-MM-DD, e.g. 2026-03-14.');
      return;
    }
    if (endDate.trim() && !end) {
      Alert.alert('Check the end date', 'Use YYYY-MM-DD, e.g. 2026-03-18.');
      return;
    }
    if (start && end && end < start) {
      Alert.alert('Check the dates', 'The trip ends before it starts.');
      return;
    }
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
        startDate: start,
        endDate: end,
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
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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

          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <Field label="Start date">
                <Input
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="2026-03-14"
                  autoCapitalize="none"
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="End date">
                <Input
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="2026-03-18"
                  autoCapitalize="none"
                />
              </Field>
            </View>
          </View>

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
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  intro: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: spacing.xl },
  dateRow: { flexDirection: 'row', gap: spacing.md },
});
