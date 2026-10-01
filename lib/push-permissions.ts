// lib/push-permissions.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Alert, Linking, Platform } from 'react-native';

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    console.log('Must use physical device for Push Notifications');
    return false;
  }

  // 1. Check current status
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // 2. If not granted, request permission
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  // 3. If granted, return true
  if (finalStatus === 'granted') {
    return true;
  }

  // 4. If denied, show Settings prompt (Android 13+ behavior)
  Alert.alert(
    'Notifications Off',
    'Airalance ko notifications bhejne ke liye permission chahiye. Kya aap settings me jaakar ise allow karna chahte hain?',
    [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Open Settings', 
        onPress: () => {
          if (Platform.OS === 'android') {
            Linking.openSettings();
          } else {
            Linking.openURL('app-settings:');
          }
        } 
      }
    ]
  );

  return false;
}
