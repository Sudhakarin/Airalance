// plugins/withCustomRingtone.js
// Expo config plugin — copies assets/ringtone.mp3 to android/app/src/main/res/raw/
// so it can be used as a native notification/call sound.

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withCustomRingtone(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const source = path.join(projectRoot, 'assets', 'ringtone.mp3');
      const destDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'res',
        'raw'
      );
      const dest = path.join(destDir, 'ringtone.mp3');

      // Create raw folder if it doesn't exist
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Copy the file
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, dest);
        console.log('[withCustomRingtone] ✅ copied ringtone.mp3 to res/raw/');
      } else {
        console.warn(
          '[withCustomRingtone] ⚠️ assets/ringtone.mp3 not found, skipping'
        );
      }

      return config;
    },
  ]);
};
