import { cp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-extension');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const require = createRequire(import.meta.url);
const esbuild = require(path.join(root, 'web/node_modules/esbuild'));

await rm(outDir, { recursive: true, force: true });

const result = spawnSync(
  npmCmd,
  ['--prefix', 'web', 'run', 'build', '--', '--outDir', '../dist-extension'],
  {
    cwd: root,
    env: { ...process.env, BUILD_TARGET: 'extension' },
    stdio: 'inherit',
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await cp(path.join(root, 'extension'), outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'web/src/extension/quick-search-content.tsx')],
  outfile: path.join(outDir, 'quick-search-content.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome114'],
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [
    {
      name: 'raw-css',
      setup(build) {
        build.onResolve({ filter: /\.css\?raw$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
          namespace: 'raw-css',
        }));
        build.onLoad({ filter: /.*/, namespace: 'raw-css' }, async (args) => ({
          contents: await readFile(args.path, 'utf8'),
          loader: 'text',
        }));
      },
    },
  ],
});

console.log(`\n扩展包已生成: ${outDir}`);
