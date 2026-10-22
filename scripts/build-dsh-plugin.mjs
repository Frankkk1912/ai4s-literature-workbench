#!/usr/bin/env node
// Builds the DeepSeek Harness plugin package as an installable tarball.
//
//   node scripts/build-dsh-plugin.mjs --out <dir>
//
// Run `npm run bundle` in runtime/ and fulltext-runtime/ first. The tarball holds the
// two prebuilt servers (servers/), the three skills plus the setup skill (skills/), and the
// patch that mounts them (cordis.patch.yml). It is assembled in a temporary folder, so the
// repository's dsh-plugin/ folder stays source-only. Install it in DeepSeek Harness with
//   dsh plugin --profile <profile> add <path-to-tgz>
// or paste the path (or the release address) into the Plugins page.
//
// scripts/package-release.mjs runs this and adds the result to the release assets.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = join(repoRoot, 'dsh-plugin');

function fail(message) {
  process.stderr.write(`build-dsh-plugin: ${message}\n`);
  process.exit(1);
}

const outIndex = process.argv.indexOf('--out');
if (outIndex === -1 || !process.argv[outIndex + 1]) fail('usage: node scripts/build-dsh-plugin.mjs --out <dir>');
const outDir = resolve(process.argv[outIndex + 1]);

const pluginVersion = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const packageVersion = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')).version;
if (pluginVersion !== packageVersion) {
  fail(`dsh-plugin/package.json is ${packageVersion} but .claude-plugin/plugin.json is ${pluginVersion}. Keep them equal.`);
}

for (const source of ['runtime', 'fulltext-runtime']) {
  if (!existsSync(join(repoRoot, source, 'bundle', 'index.mjs'))) fail(`missing ${source}/bundle/index.mjs. Run npm run bundle in ${source}/ first.`);
}

const staging = mkdtempSync(join(tmpdir(), 'ai4s-dsh-plugin-'));
try {
  for (const file of ['package.json', 'cordis.patch.yml', 'README.md']) cpSync(join(pluginDir, file), join(staging, file));
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(join(repoRoot, file), join(staging, file));
  cpSync(join(repoRoot, 'runtime', 'bundle'), join(staging, 'servers', 'runtime'), { recursive: true });
  cpSync(join(repoRoot, 'fulltext-runtime', 'bundle'), join(staging, 'servers', 'fulltext-runtime'), { recursive: true });
  cpSync(join(repoRoot, 'skills'), join(staging, 'skills'), {
    recursive: true,
    filter: (path) => !/[\\/](tests|__pycache__)([\\/]|$)/.test(path) && !path.endsWith('.pyc'),
  });

  mkdirSync(outDir, { recursive: true });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['pack', '--pack-destination', outDir], { cwd: staging, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) fail('npm pack failed.');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
process.stdout.write(`\nbuild-dsh-plugin: wrote ${join(outDir, `dsh-ai4s-literature-workbench-${packageVersion}.tgz`)}\n`);
