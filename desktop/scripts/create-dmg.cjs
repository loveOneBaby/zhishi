const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const desktopDir = path.resolve(__dirname, '..');
const projectDir = path.resolve(desktopDir, '..');
const releaseDir = path.join(projectDir, 'release');
const pkg = require(path.join(desktopDir, 'package.json'));
const productName = pkg.build?.productName || '知识检索';
const appName = `${productName}.app`;
const volumeName = `双击安装知识检索 ${pkg.version}`;
const appPath = path.join(releaseDir, 'mac-arm64', appName);
const outputDmg = path.join(releaseDir, `${pkg.name}-${pkg.version}.dmg`);
const outputBlockmap = `${outputDmg}.blockmap`;
const backgroundPath = path.join(desktopDir, 'assets', 'dmg-background.png');
const iconPath = path.join(desktopDir, 'assets', 'icon.icns');
const appBuilderBin = path.join(
  desktopDir,
  'node_modules',
  'app-builder-bin',
  'mac',
  process.arch === 'arm64' ? 'app-builder_arm64' : 'app-builder_amd64',
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    if (options.allowFailure) return result;
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `\n${detail}` : ''}`);
  }

  return result.stdout || '';
}

function sleep(seconds) {
  spawnSync('sleep', [String(seconds)], { stdio: 'ignore' });
}

function detachVolume(mountPoint) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const args = attempt >= 3 ? ['detach', '-force', mountPoint] : ['detach', mountPoint];
    const result = run('hdiutil', args, { capture: true, allowFailure: true });
    if (result.status === 0 || !fs.existsSync(mountPoint)) return;
    sleep(1);
  }

  run('hdiutil', ['detach', '-force', mountPoint]);
}

function detachIfMounted() {
  const mountPoint = path.join('/Volumes', volumeName);
  if (fs.existsSync(mountPoint)) {
    detachVolume(mountPoint);
  }
}

function appleScriptForFinderLayout() {
  return `
on run argv
  set volumePath to item 1 of argv
  set applicationName to item 2 of argv
  set backgroundPath to item 3 of argv

  tell application "Finder"
    set volumeFolder to POSIX file volumePath as alias
    open volumeFolder
    delay 0.4

    set volumeWindow to container window of volumeFolder
    set current view of volumeWindow to icon view
    set toolbar visible of volumeWindow to false
    set statusbar visible of volumeWindow to false
    set bounds of volumeWindow to {360, 180, 980, 540}

    set viewOptions to icon view options of volumeWindow
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 112
    set text size of viewOptions to 14
    set background picture of viewOptions to POSIX file backgroundPath as alias

    set position of item applicationName of volumeFolder to {310, 136}
    update volumeFolder without registering applications
    delay 1
    close volumeWindow
  end tell
end run
`;
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Custom DMG build requires macOS.');
  }
  if (!fs.existsSync(appPath)) {
    throw new Error(`Missing app bundle: ${appPath}`);
  }
  if (!fs.existsSync(backgroundPath)) {
    throw new Error(`Missing DMG background: ${backgroundPath}`);
  }
  if (!fs.existsSync(appBuilderBin)) {
    throw new Error(`Missing app-builder binary: ${appBuilderBin}`);
  }

  fs.mkdirSync(releaseDir, { recursive: true });
  fs.rmSync(outputDmg, { force: true });
  fs.rmSync(outputBlockmap, { force: true });

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-knowledge-dmg-'));
  const stageDir = path.join(tmpRoot, 'stage');
  const backgroundDir = path.join(stageDir, '.background');
  const writableDmg = path.join(tmpRoot, 'writable.dmg');

  try {
    fs.mkdirSync(backgroundDir, { recursive: true });
    fs.cpSync(appPath, path.join(stageDir, appName), { recursive: true, verbatimSymlinks: true });
    fs.copyFileSync(backgroundPath, path.join(backgroundDir, 'background.png'));
    if (fs.existsSync(iconPath)) {
      fs.copyFileSync(iconPath, path.join(stageDir, '.VolumeIcon.icns'));
    }

    detachIfMounted();

    run('hdiutil', [
      'create',
      '-srcfolder',
      stageDir,
      '-volname',
      volumeName,
      '-fs',
      'HFS+',
      '-fsargs',
      '-c c=64,a=16,e=16',
      '-format',
      'UDRW',
      '-ov',
      writableDmg,
    ]);

    const attachOutput = run('hdiutil', [
      'attach',
      '-readwrite',
      '-noverify',
      '-noautoopen',
      writableDmg,
    ], { capture: true });

    const mountPoint = attachOutput
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.includes(`/Volumes/${volumeName}`))
      ?.match(/\/Volumes\/.+$/)?.[0];

    if (!mountPoint || !fs.existsSync(mountPoint)) {
      throw new Error(`Unable to find mounted DMG volume in hdiutil output:\n${attachOutput}`);
    }

    const mountedBackground = path.join(mountPoint, '.background', 'background.png');
    run('chflags', ['hidden', path.join(mountPoint, '.background')]);
    if (fs.existsSync('/usr/bin/SetFile') && fs.existsSync(path.join(mountPoint, '.VolumeIcon.icns'))) {
      run('/usr/bin/SetFile', ['-a', 'C', mountPoint]);
    }
    run('osascript', ['-e', appleScriptForFinderLayout(), mountPoint, appName, mountedBackground]);
    run('sync', []);
    detachVolume(mountPoint);

    run('hdiutil', [
      'convert',
      writableDmg,
      '-format',
      'UDZO',
      '-imagekey',
      'zlib-level=9',
      '-ov',
      '-o',
      outputDmg,
    ]);

    run(appBuilderBin, ['blockmap', '--input', outputDmg, '--output', outputBlockmap]);
    console.log(`Created ${outputDmg}`);
    console.log(`Created ${outputBlockmap}`);
  } finally {
    detachIfMounted();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
