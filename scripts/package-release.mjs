#!/usr/bin/env node
// Builds the release assets from already-built inputs. It never publishes anything.
//
//   node scripts/package-release.mjs --out <dir> [--version <x.y.z>] [--skip-mcpb]
//
// Run first:  npm run bundle   (in runtime/ and fulltext-runtime/)
//             npm ci && npm run package   (in literature-metrics/)
//
// Writes into <dir>:
//   ai4s-literature-workbench-<version>.zip   plugin archive: skills, manifests, prebuilt
//                                             bundles, and a .mcp.json that points at them
//   ai4s-literature-zotero-<version>.mcpb     Claude Desktop bundle (validated and packed
//                                             with the official mcpb CLI)
//   literature-metrics-<xpi version>.xpi      the Zotero add-on
//   literature-metrics.xpi                    the same file under a fixed name, so the link
//                                             .../releases/latest/download/literature-metrics.xpi
//                                             always gives the newest add-on
//   SHA256SUMS.txt                            checked with `sha256sum -c` or Get-FileHash
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { checkFeed } = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'literature-metrics', 'scripts', 'update-feed.mjs')).href);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

// The mcpb CLI is pinned so a new release of it cannot change a release build.
const MCPB_PACKAGE = '@anthropic-ai/mcpb@2.1.2';

function fail(message) {
  process.stderr.write(`package-release: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { out: undefined, version: undefined, skipMcpb: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--skip-mcpb') args.skipMcpb = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (!args.out) fail('usage: node scripts/package-release.mjs --out <dir> [--version <x.y.z>] [--skip-mcpb]');
  return args;
}

function readJson(relative) {
  return JSON.parse(readFileSync(join(repoRoot, relative), 'utf8'));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: isWindows, ...options });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with code ${result.status}.`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function copyTree(source, destination, skip = () => false) {
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => !skip(basename(path)),
  });
}

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(args.out);

// --- Inputs must exist; say which build step produces each one. ---

const pluginVersion = readJson('.claude-plugin/plugin.json').version;
const version = args.version ?? pluginVersion;
if (version !== pluginVersion) {
  fail(`release version ${version} does not match .claude-plugin/plugin.json (${pluginVersion}). Bump the plugin manifests first.`);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version must look like 1.2.3, got "${version}".`);

for (const [relative, step] of [
  ['runtime/bundle/index.mjs', 'npm run bundle (in runtime/)'],
  ['fulltext-runtime/bundle/index.mjs', 'npm run bundle (in fulltext-runtime/)'],
]) {
  if (!existsSync(join(repoRoot, relative))) fail(`missing ${relative}. Run ${step} first.`);
}
const xpiDir = join(repoRoot, 'literature-metrics', 'dist');
const xpiVersion = readJson('literature-metrics/manifest.json').version;
const xpiName = `literature-metrics-${xpiVersion}.xpi`;
if (!existsSync(join(xpiDir, xpiName))) fail(`missing literature-metrics/dist/${xpiName}. Run npm run package (in literature-metrics/) first.`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const staging = join(outDir, '.staging');
const assets = [];

// --- Plugin archive ---

const pluginName = `ai4s-literature-workbench-${version}`;
const pluginRoot = join(staging, pluginName);
mkdirSync(pluginRoot, { recursive: true });

for (const dir of ['.claude-plugin', '.codex-plugin', '.codebuddy-plugin']) {
  copyTree(join(repoRoot, dir), join(pluginRoot, dir));
}
copyTree(join(repoRoot, 'skills'), join(pluginRoot, 'skills'), (name) => name === 'tests' || name === '__pycache__' || name.endsWith('.pyc'));
copyTree(join(repoRoot, 'runtime', 'bundle'), join(pluginRoot, 'runtime', 'bundle'));
copyTree(join(repoRoot, 'fulltext-runtime', 'bundle'), join(pluginRoot, 'fulltext-runtime', 'bundle'));
// Double-click setup for hosts whose sandbox cannot start a server or a browser. Each runs
// the bundle with --setup. The .command needs its execute bit to open from Finder.
for (const name of ['Setup AI4S.bat', 'Setup AI4S.command']) {
  cpSync(join(repoRoot, 'release', 'launchers', name), join(pluginRoot, name));
}
chmodSync(join(pluginRoot, 'Setup AI4S.command'), 0o755);
mkdirSync(join(pluginRoot, 'scripts'), { recursive: true });
cpSync(join(repoRoot, 'scripts', 'install-host.mjs'), join(pluginRoot, 'scripts', 'install-host.mjs'));
for (const file of [
  'bundle-manifest.json', 'install-manifest.json', 'INSTALL.md', 'README.md', 'README_CN.md',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md',
]) {
  cpSync(join(repoRoot, file), join(pluginRoot, file));
}

// The archive's .mcp.json runs the bundles instead of dist/ folders that do not exist here.
const mcp = readJson('.mcp.json');
const rewrites = new Map([
  ['./runtime/dist/index.js', './runtime/bundle/index.mjs'],
  ['./fulltext-runtime/dist/index.js', './fulltext-runtime/bundle/index.mjs'],
]);
let rewritten = 0;
for (const server of Object.values(mcp.mcpServers)) {
  server.args = server.args.map((arg) => {
    if (!rewrites.has(arg)) return arg;
    rewritten += 1;
    return rewrites.get(arg);
  });
}
// database-browser-runtime is optional and needs a browser download, so it stays out of every default route.
if (JSON.stringify(mcp).includes('database-browser')) fail('.mcp.json must not start database-browser-runtime by default.');
if (rewritten !== rewrites.size) fail(`.mcp.json no longer has the expected dist entries (rewrote ${rewritten} of ${rewrites.size}).`);
writeFileSync(join(pluginRoot, '.mcp.json'), `${JSON.stringify(mcp, null, 2)}\n`);

const zipPath = join(outDir, `${pluginName}.zip`);
if (isWindows) {
  // bsdtar ships with Windows 10+ and writes zip when asked by extension.
  run('tar', ['-a', '-cf', zipPath, '-C', staging, pluginName]);
} else {
  run('zip', ['-X', '-r', '-q', zipPath, pluginName], { cwd: staging });
}
assets.push(zipPath);

// --- Claude Desktop bundle ---

if (args.skipMcpb) {
  process.stdout.write('package-release: --skip-mcpb given, so no .mcpb was produced.\n');
} else {
  const mcpbRoot = join(staging, 'mcpb');
  mkdirSync(join(mcpbRoot, 'server'), { recursive: true });
  const manifest = readFileSync(join(repoRoot, 'release', 'mcpb', 'manifest.json'), 'utf8').replaceAll('__VERSION__', version);
  writeFileSync(join(mcpbRoot, 'manifest.json'), manifest);
  cpSync(join(repoRoot, 'runtime', 'dxt', 'icon.png'), join(mcpbRoot, 'icon.png'));
  // The server file, the setup page beside it, and the license notices.
  for (const entry of readdirSync(join(repoRoot, 'runtime', 'bundle'))) {
    cpSync(join(repoRoot, 'runtime', 'bundle', entry), join(mcpbRoot, 'server', entry), { recursive: true });
  }
  const mcpbPath = join(outDir, `ai4s-literature-zotero-${version}.mcpb`);
  run('npx', ['--yes', MCPB_PACKAGE, 'validate', mcpbRoot]);
  run('npx', ['--yes', MCPB_PACKAGE, 'pack', mcpbRoot, mcpbPath]);
  assets.push(mcpbPath);
}

// --- Zotero add-on ---

// The update feed Zotero reads (literature-metrics/update.json) must describe these exact bytes
// and point at this release, or installed copies would never update.
const xpiBytes = readFileSync(join(xpiDir, xpiName));
const feedProblems = checkFeed({
  manifest: readJson('literature-metrics/manifest.json'),
  feed: readJson('literature-metrics/update.json'),
  xpiBytes,
  pluginVersion: version,
});
if (feedProblems.length > 0) fail(`literature-metrics/update.json is out of step with the add-on:\n- ${feedProblems.join('\n- ')}`);

for (const name of [xpiName, 'literature-metrics.xpi']) {
  const xpiPath = join(outDir, name);
  cpSync(join(xpiDir, xpiName), xpiPath);
  assets.push(xpiPath);
}

rmSync(staging, { recursive: true, force: true });

// --- Checksums, last, so they cover every file above ---

const sums = assets
  .map((path) => `${sha256(path)}  ${basename(path)}`)
  .sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
writeFileSync(join(outDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

process.stdout.write('\npackage-release: wrote\n');
for (const path of [...assets, join(outDir, 'SHA256SUMS.txt')]) {
  process.stdout.write(`  ${basename(path).padEnd(52)} ${(statSync(path).size / 1024 / 1024).toFixed(2)} MB\n`);
}
