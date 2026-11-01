// lib/push-permissions.ts
// Thin wrapper kept for backward compatibility — the real logic now lives in
// lib/permissions.ts, so there is never a duplicate prompt.
// Use this for a manual "Enable notifications" button; it asks again and, if
// the permission is blocked, offers "Open Settings".

import { Alert, Linking } from 'react-native';
import { ensureNotifications } from './permissions';

export async function requestNotificationPermission(): Promise<boolean> {
  const status = await ensureNotifications();
  if (status === 'granted') return true;

  Alert.alert(
    'Notifications Off',
    'Airalance ko notifications bhejne ke liye permission chahiye. Kya aap settings me jaakar ise allow karna chahte hain?',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: () => {
          Linking.openSettings().catch(() => {});
        },
      },
    ]
  );

  return false;
}
