import React, { useState } from 'react';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '@/theme';
import { formatDate, parseISODate, toISODate } from '@/lib/format';

/**
 * Tap-to-pick date control backed by the native picker.
 *
 * Typing dates into a TextInput was the original design and it was wrong on a
 * phone: the keyboard covers the field, and free-text dates need parsing and
 * error states that a picker makes impossible by construction.
 *
 * The two platforms want different things, so this renders differently:
 * iOS gets a modal sheet with an inline calendar and explicit Cancel/Done
 * (an iOS picker has no built-in dismissal); Android gets the system dialog,
 * which brings its own buttons and fires one terminal event.
 */
export function DateField({
  label,
  value,
  onChange,
  placeholder = 'Not set',
  minimumDate,
  maximumDate,
  clearable = true,
}: {
  label: string;
  /** ISO YYYY-MM-DD, or null when unset. */
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => (value && parseISODate(value)) || new Date());

  const show = () => {
    setDraft((value && parseISODate(value)) || new Date());
    setOpen(true);
  };

  // Android's dialog is self-dismissing and reports the outcome in one event.
  const onAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    setOpen(false);
    if (event.type === 'set' && selected) onChange(toISODate(selected));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ? formatDate(value) : placeholder}`}
          onPress={show}
          style={({ pressed }) => [styles.control, pressed && { opacity: 0.75 }]}
        >
          <Text style={[styles.value, !value && styles.placeholder]}>
            {value ? formatDate(value) : placeholder}
          </Text>
        </Pressable>
        {clearable && value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            onPress={() => onChange(null)}
            hitSlop={10}
            style={styles.clear}
          >
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={draft}
          mode="date"
          display="default"
          onChange={onAndroidChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <Text style={styles.sheetAction}>Cancel</Text>
              </Pressable>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable
                onPress={() => {
                  onChange(toISODate(draft));
                  setOpen(false);
                }}
                hitSlop={10}
              >
                <Text style={[styles.sheetAction, styles.sheetDone]}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={draft}
              mode="date"
              display="inline"
              themeVariant="dark"
              onChange={(_event, selected) => {
                if (selected) setDraft(selected);
              }}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              style={styles.picker}
            />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  label: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  control: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  value: { color: colors.text, fontSize: 16 },
  placeholder: { color: colors.textFaint },
  clear: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  clearText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  sheetAction: { color: colors.textDim, fontSize: 16 },
  sheetDone: { color: colors.accent, fontWeight: '700' },
  picker: { marginHorizontal: spacing.sm },
});
