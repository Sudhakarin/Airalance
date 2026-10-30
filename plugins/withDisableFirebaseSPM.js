const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withAiralanceFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf-8');

      // 1. Firebase SPM disable
      if (!podfile.includes('$RNFirebaseDisableSPM = true')) {
        podfile = `$RNFirebaseDisableSPM = true\n${podfile}`;
      }

      // 2. Firebase ko static framework banne do taaki module maps generate ho
      if (!podfile.includes('$RNFirebaseAsStaticFramework = true')) {
        podfile = `$RNFirebaseAsStaticFramework = true\n${podfile}`;
      }

      // 3. Modulemap recreate karne ka fix inject karo
      if (!podfile.includes('[Airalance Fix]')) {
        const postInstallScript = `
    # [Airalance Fix] React-Core-prebuilt delete hone ke baad modulemap recreate karo
    react_core_target = installer.pods_project.targets.find { |t| t.name == 'React-Core-prebuilt' }
    if react_core_target
      react_core_target.shell_script_build_phases.each do |phase|
        if phase.name&.include?('Replace React Native Core')
          unless phase.shell_script.include?('React-use-frameworks.modulemap')
            phase.shell_script += %q(
# [Airalance Fix] Tarball extraction ke baad modulemap recreate karo
MODULEMAP_PATH="\${PODS_ROOT}/React-Core-prebuilt/React-use-frameworks.modulemap"
if [ ! -f "$MODULEMAP_PATH" ]; then
  cat > "$MODULEMAP_PATH" << 'MODULEMAP'
module React {
  umbrella header "React.xcframework/Headers/React_Core/React_Core-umbrella.h"
  export *
}
MODULEMAP
  echo "[Airalance Fix] Created React-use-frameworks.modulemap"
fi
            )
          end
        end
      end
    end
        `;

        // post_install block me inject karo
        if (podfile.includes('post_install do |installer|')) {
          podfile = podfile.replace(
            /post_install do \|installer\|([\s\S]*?)(\n\s*end\s*$)/m,
            (match, body, ending) => `post_install do |installer|${body}\n${postInstallScript}${ending}`
          );
        } else {
          podfile += `\npost_install do |installer|\n${postInstallScript}\nend\n`;
        }
      }

      fs.writeFileSync(podfilePath, podfile);
      console.log('✅ [Airalance Fix] Firebase SPM disable + Static framework + Modulemap fix added');
      
      return config;
    },
  ]);
};
