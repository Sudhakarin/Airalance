const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withDisableFirebaseSPM(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf-8');
      
      // 1. Firebase SPM disable karne ke liye
      if (!podfile.includes('$RNFirebaseDisableSPM = true')) {
        podfile = `$RNFirebaseDisableSPM = true\n${podfile}`;
      }

      // 2. Expo.modulemap delete hone se rokne ke liye Prebuilt Core disable karo
      if (!podfile.includes('RCT_USE_PREBUILT_RNCORE')) {
        podfile = `ENV['RCT_USE_PREBUILT_RNCORE'] = '0'\nENV['RCT_USE_RN_DEP'] = '0'\n${podfile}`;
      }

      fs.writeFileSync(podfilePath, podfile);
      console.log('✅ [Airalance Fix] Added Firebase SPM + Prebuilt Core disable to Podfile');
      
      return config;
    },
  ]);
};
