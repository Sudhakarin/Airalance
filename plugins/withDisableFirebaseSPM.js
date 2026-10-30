const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withDisableFirebaseSPM(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf-8');
      
      // Sirf Firebase SPM disable karne ke liye
      if (!podfile.includes('$RNFirebaseDisableSPM = true')) {
        podfile = `$RNFirebaseDisableSPM = true\n${podfile}`;
        fs.writeFileSync(podfilePath, podfile);
        console.log('✅ [withDisableFirebaseSPM] Added $RNFirebaseDisableSPM = true to Podfile');
      }
      return config;
    },
  ]);
};
