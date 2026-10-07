// plugins/withCallKeep.js
// Expo config plugin — injects react-native-callkeep native setup into AndroidManifest
// ✅ Includes MainActivity showWhenLocked + turnScreenOn for full-screen call UI

const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withCallKeep(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    if (!mainApplication.service) mainApplication.service = [];
    if (!mainApplication.receiver) mainApplication.receiver = [];

    // 1. VoiceConnectionService
    if (
      !mainApplication.service.some(
        (s) => s.$['android:name'] === 'io.wazo.callkeep.VoiceConnectionService'
      )
    ) {
      mainApplication.service.push({
        $: {
          'android:name': 'io.wazo.callkeep.VoiceConnectionService',
          'android:label': 'Airalance',
          'android:permission':
            'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
          'android:foregroundServiceType': 'phoneCall|microphone',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.telecom.ConnectionService' } },
            ],
          },
        ],
      });
    }

    // 2. BackgroundMessagingService
    if (
      !mainApplication.service.some(
        (s) =>
          s.$['android:name'] ===
          'io.wazo.callkeep.RNCallKeepBackgroundMessagingService'
      )
    ) {
      mainApplication.service.push({
        $: {
          'android:name':
            'io.wazo.callkeep.RNCallKeepBackgroundMessagingService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone|phoneCall',
        },
      });
    }

    // 3. IncomingCallReceiver
    if (
      !mainApplication.receiver.some(
        (r) =>
          r.$['android:name'] ===
          'io.wazo.callkeep.RNCallKeepIncomingCallReceiver'
      )
    ) {
      mainApplication.receiver.push({
        $: {
          'android:name': 'io.wazo.callkeep.RNCallKeepIncomingCallReceiver',
          'android:enabled': 'true',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: { 'android:name': 'io.wazo.callkeep.ACTION_INCOMING_CALL' },
              },
            ],
          },
        ],
      });
    }

    // 4. ✅ CRITICAL FIX — MainActivity attributes for full-screen intent
    const mainActivity = (mainApplication.activity || []).find((a) =>
      /\.MainActivity$/.test(a.$['android:name'] || '')
    );
    if (mainActivity) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn'] = 'true';
      mainActivity.$['android:excludeFromRecents'] = 'false';
      mainActivity.$['android:launchMode'] = 'singleTask';
      mainActivity.$['android:taskAffinity'] = '';
      console.log(
        '[withCallKeep] ✅ MainActivity updated with showWhenLocked + turnScreenOn'
      );
    } else {
      console.warn('[withCallKeep] ⚠️ MainActivity not found');
    }

    return config;
  });
};
