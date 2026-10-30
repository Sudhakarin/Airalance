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

      // 2. GeneratedAssetSymbols.swift ko disable karne ke liye
      // (Ye line post_install block ke andar daalni hai)
      if (!podfile.includes('ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS')) {
        // Agar post_install block hai to uske andar add karo
        if (podfile.includes('post_install do |installer|')) {
          podfile = podfile.replace(
            'post_install do |installer|',
            `post_install do |installer|
    installer.pods_project.build_configurations.each do |config|
      config.build_settings['ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS'] = 'NO'
    end`
          );
        } else {
          // Agar post_install block nahi hai to file ke end me add karo
          podfile += `\npost_install do |installer|\n  installer.pods_project.build_configurations.each do |config|\n    config.build_settings['ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS'] = 'NO'\n  end\nend\n`;
        }
      }

      fs.writeFileSync(podfilePath, podfile);
      console.log('✅ [withDisableFirebaseSPM] Added SPM disable + AssetSymbols disable to Podfile');
      
      return config;
    },
  ]);
};
