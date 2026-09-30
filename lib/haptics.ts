// lib/haptics.ts
// Centralized haptic feedback helpers — WhatsApp-style feel

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Skip on web (haptics don't work in browser)
const enabled = Platform.OS !== 'web';

/**
 * Very light tap — for subtle interactions
 * Use: message send, small toggles, button press
 */
export function hapticLight() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/**
 * Medium impact — for confirmation actions
 * Use: long press menu open, reaction add, PIN correct
 */
export function hapticMedium() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/**
 * Heavy impact — for destructive or important actions
 * Use: delete, block, error states
 */
export function hapticHeavy() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

/**
 * Success notification — double vibration
 * Use: PIN correct, lock success, message sent successfully
 */
export function hapticSuccess() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => {}
  );
}

/**
 * Error notification — triple vibration
 * Use: PIN incorrect, form validation fail
 */
export function hapticError() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
    () => {}
  );
}

/**
 * Warning notification
 * Use: caution actions
 */
export function hapticWarning() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
    () => {}
  );
}

/**
 * Selection change — very subtle
 * Use: toggling between tabs, switching options
 */
export function hapticSelection() {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => {});
}
