// plugins/withNotifee.js
// Notifee ships its native core as a local maven repo inside node_modules.
// This adds that repo to android/build.gradle (harmless if not needed).

const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withNotifee(config) {
  return withProjectBuildGradle(config, (cfg) => {
    const marker = '@notifee/react-native/android/libs';
    if (cfg.modResults.language !== 'groovy') return cfg;
    if (cfg.modResults.contents.includes(marker)) return cfg;

    cfg.modResults.contents = cfg.modResults.contents.replace(
      /allprojects\s*\{\s*repositories\s*\{/,
      (m) =>
        m +
        '\n        maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }'
    );
    return cfg;
  });
};
