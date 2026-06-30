const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = fs.readdirSync(context.appOutDir).find((name) => name.endsWith('.app'));
  if (!appName) {
    throw new Error(`No .app bundle found in ${context.appOutDir}`);
  }

  const appPath = path.join(context.appOutDir, appName);
  console.log(`[afterPack] ad-hoc signing ${appPath}`);

  const result = spawnSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' },
  );

  if (result.status !== 0) {
    throw new Error(`codesign failed with status ${result.status}`);
  }
};
