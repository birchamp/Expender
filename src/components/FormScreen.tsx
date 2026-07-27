import React from 'react';
import { Platform, ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Screen } from './ui';
import { spacing } from '@/theme';

/**
 * Scrolling form body that keeps the focused input above the keyboard.
 *
 * The previous approach — KeyboardAvoidingView with a hard-coded
 * `keyboardVerticalOffset` — was wrong by construction: the correct offset
 * differs between a stack screen and a modal, and between devices, so any
 * single number leaves some field covered.
 *
 * iOS instead gets `automaticallyAdjustKeyboardInsets`, which asks UIKit for
 * the real keyboard frame and adjusts the scroll insets itself. Android needs
 * nothing: `adjustResize` (Expo's default) resizes the window, and a
 * ScrollView inside it simply scrolls.
 */
export function FormScreen({
  children,
  contentContainerStyle,
}: {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentInsetAdjustmentBehavior="automatic"
      >
        {children}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
});
