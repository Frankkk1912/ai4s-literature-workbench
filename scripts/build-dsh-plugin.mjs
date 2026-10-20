#!/usr/bin/env node
// Builds the DeepSeek Harness plugin package as an installable tarball.
//
//   node scripts/build-dsh-plugin.mjs --out <dir>
//
// Run `npm run bundle` in runtime/ and fulltext-runtime/ first. The tarball holds the
// two prebuilt servers (servers/), the three skills (skills/), and the patch that mounts
// them (cordis.patch.yml). Install it in DeepSeek Harness with
//   dsh plugin --profile <profile> add <path-to-tgz>
// or paste the path into the Plugins page.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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

for (const [source, name] of [['runtime', 'runtime'], ['fulltext-runtime', 'fulltext-runtime']]) {
  if (!existsSync(join(repoRoot, source, 'bundle', 'index.mjs'))) fail(`missing ${source}/bundle/index.mjs. Run npm run bundle in ${source}/ first.`);
}

// Copies are build output, so rebuild them from scratch each time.
rmSync(join(pluginDir, 'servers'), { recursive: true, force: true });
rmSync(join(pluginDir, 'skills'), { recursive: true, force: true });
cpSync(join(repoRoot, 'runtime', 'bundle'), join(pluginDir, 'servers', 'runtime'), { recursive: true });
cpSync(join(repoRoot, 'fulltext-runtime', 'bundle'), join(pluginDir, 'servers', 'fulltext-runtime'), { recursive: true });
cpSync(join(repoRoot, 'skills'), join(pluginDir, 'skills'), {
  recursive: true,
  filter: (path) => !/[\\/](tests|__pycache__)([\\/]|$)/.test(path) && !path.endsWith('.pyc'),
});

mkdirSync(outDir, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['pack', '--pack-destination', outDir], { cwd: pluginDir, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) fail('npm pack failed.');
process.stdout.write(`\nbuild-dsh-plugin: wrote ${join(outDir, `dsh-ai4s-literature-workbench-${packageVersion}.tgz`)}\n`);
