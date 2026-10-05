// plugins/withCallKeep.js
// Expo config plugin — injects react-native-callkeep native setup into AndroidManifest

const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withCallKeep(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    if (!mainApplication.service) {
      mainApplication.service = [];
    }
    if (!mainApplication.receiver) {
      mainApplication.receiver = [];
    }

    // 1. VoiceConnectionService
    const hasVoiceService = mainApplication.service.some(
      (s) => s.$['android:name'] === 'io.wazo.callkeep.VoiceConnectionService'
    );
    if (!hasVoiceService) {
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
              {
                $: { 'android:name': 'android.telecom.ConnectionService' },
              },
            ],
          },
        ],
      });
    }

    // 2. BackgroundMessagingService
    const hasBgService = mainApplication.service.some(
      (s) =>
        s.$['android:name'] ===
        'io.wazo.callkeep.RNCallKeepBackgroundMessagingService'
    );
    if (!hasBgService) {
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
    const hasReceiver = mainApplication.receiver.some(
      (r) =>
        r.$['android:name'] ===
        'io.wazo.callkeep.RNCallKeepIncomingCallReceiver'
    );
    if (!hasReceiver) {
      mainApplication.receiver.push({
        $: {
          'android:name':
            'io.wazo.callkeep.RNCallKeepIncomingCallReceiver',
          'android:enabled': 'true',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'io.wazo.callkeep.ACTION_INCOMING_CALL',
                },
              },
            ],
          },
        ],
      });
    }

    return config;
  });
};
