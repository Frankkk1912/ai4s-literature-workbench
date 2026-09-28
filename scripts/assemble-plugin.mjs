#!/usr/bin/env node
/**
 * In-repository workbench check.
 *
 * Usage:
 *   node scripts/assemble-plugin.mjs check
 *
 * The historical parent-checkout sync mode is gone. This command does not
 * read or write any checkout outside this repository, and it does not compare
 * fixed source hashes. Normal source edits pass as long as structure, lockfile
 * sync, and build inputs still rebuild.
 *
 * Dist entries are build outputs, not source. This command does not build them.
 * If one is missing it exits non-zero and prints the build command, for example:
 *   cd runtime && npm ci && npm run build
 *   cd fulltext-runtime && npm ci && npm run build
 *
 * Rebuildability:
 *   - each npm package lockfile must be acceptable to `npm ci --ignore-scripts --dry-run`
 *   - each TypeScript build entry must be non-empty, contain `async function main`,
 *     and pass `tsc --noEmit` (requires that package's npm ci)
 *   - literature-metrics build inputs must pass `node scripts/check.mjs`
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const command = process.argv[2];
if (command === 'sync') {
  throw new Error('sync was removed. This repository is the source of truth. Usage: node scripts/assemble-plugin.mjs check');
}
if (command !== 'check') {
  throw new Error('Usage: node scripts/assemble-plugin.mjs check');
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function inside(path) {
  const rel = relative(repoRoot, path);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to touch a path outside this repository: ${path}`);
  }
  return path;
}

function repoPath(rel) {
  return inside(resolve(repoRoot, rel));
}

function readJson(rel) {
  return JSON.parse(readFileSync(repoPath(rel), 'utf8'));
}

function containsKey(value, key) {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((child) => containsKey(child, key));
}

function assertStructure(manifest) {
  const requiredFiles = [
    'skills/literature-research/SKILL.md',
    'skills/literature-manager/SKILL.md',
    'skills/literature-writing/SKILL.md',
    'runtime/src/index.ts',
    'runtime/package.json',
    'runtime/package-lock.json',
    'fulltext-runtime/src/index.ts',
    'fulltext-runtime/package.json',
    'fulltext-runtime/package-lock.json',
    'database-browser-runtime/src/index.ts',
    'database-browser-runtime/package.json',
    'database-browser-runtime/package-lock.json',
    'literature-metrics/manifest.json',
    'tests',
    'scripts',
    '.mcp.json',
    'bundle-manifest.json',
  ];
  for (const rel of requiredFiles) {
    if (!existsSync(repoPath(rel))) fail(`Missing required path: ${rel}`);
  }
  for (const rel of manifest.support ?? []) {
    if (!existsSync(repoPath(rel))) fail(`Missing support path recorded in bundle-manifest.json: ${rel}`);
  }
  for (const rel of manifest.host_manifests ?? []) {
    if (!existsSync(repoPath(rel))) fail(`Missing host manifest: ${rel}`);
  }
}

function assertManifest(manifest) {
  if (manifest.schema_version !== 2) fail('bundle-manifest.json schema_version must be 2');
  if (manifest.source_of_truth !== 'this-repository') {
    fail('bundle-manifest.json source_of_truth must be this-repository');
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'source_root')) {
    fail('bundle-manifest.json must not record a source_root');
  }
  if (containsKey(manifest, 'sha256')) {
    fail('bundle-manifest.json must not store fixed source hashes');
  }
  const expectedBundles = [
    ['literature-research', 'skills/literature-research'],
    ['literature-manager', 'skills/literature-manager'],
    ['literature-writing', 'skills/literature-writing'],
    ['runtime', 'runtime'],
    ['fulltext-runtime', 'fulltext-runtime'],
    ['database-browser-runtime', 'database-browser-runtime'],
    ['literature-metrics', 'literature-metrics'],
  ];
  const bundles = new Map((manifest.bundles ?? []).map((bundle) => [bundle.id, bundle]));
  for (const [id, path] of expectedBundles) {
    const bundle = bundles.get(id);
    if (!bundle) {
      fail(`bundle-manifest.json is missing bundle ${id}`);
      continue;
    }
    if (bundle.path !== path) fail(`bundle ${id} path must be ${path}`);
    for (const marker of bundle.markers ?? []) {
      const rel = `${bundle.path}/${marker}`;
      if (!existsSync(repoPath(rel))) fail(`Missing bundle marker: ${rel}`);
    }
  }
  const packages = new Map((manifest.packages ?? []).map((pkg) => [pkg.path, pkg]));
  for (const path of ['runtime', 'fulltext-runtime', 'database-browser-runtime', 'literature-metrics']) {
    if (!packages.has(path)) fail(`bundle-manifest.json is missing package ${path}`);
  }
  const artifacts = new Map((manifest.artifacts ?? []).map((artifact) => [artifact.path, artifact]));
  for (const path of ['runtime/dist/index.js', 'fulltext-runtime/dist/index.js']) {
    if (!artifacts.has(path)) fail(`bundle-manifest.json is missing artifact ${path}`);
  }
  return { packages: [...packages.values()], artifacts: [...artifacts.values()] };
}

function assertArtifacts(artifacts) {
  for (const artifact of artifacts) {
    const path = repoPath(artifact.path);
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
      const hint = artifact.produced_by || `build ${artifact.path} before check`;
      fail(`Missing build artifact ${artifact.path}. Build it first: ${hint}`);
    }
  }
}

function assertMcpResolution(artifacts) {
  let mcp;
  try {
    mcp = readJson('.mcp.json');
  } catch (error) {
    fail(`.mcp.json is not readable JSON: ${error instanceof Error ? error.message : error}`);
    return;
  }
  const expected = new Map(artifacts.map((artifact) => [artifact.mcp_server, artifact.path]));
  const servers = mcp.mcpServers ?? {};
  for (const [name, artifactPath] of expected) {
    const server = servers[name];
    if (!server) {
      fail(`.mcp.json is missing server ${name}`);
      continue;
    }
    const cwd = server.cwd || '.';
    const args = Array.isArray(server.args) ? server.args : [];
    const entry = args.find((arg) => typeof arg === 'string' && (arg.startsWith('./') || arg.startsWith('../')));
    if (!entry) {
      fail(`.mcp.json server ${name} has no relative entry argument`);
      continue;
    }
    const resolved = inside(resolve(repoRoot, cwd, entry));
    const expectedPath = repoPath(artifactPath);
    if (resolved !== expectedPath) {
      fail(`.mcp.json server ${name} resolves ${entry} to ${relative(repoRoot, resolved)}, expected ${artifactPath}`);
    }
    if (!existsSync(resolved)) {
      fail(`.mcp.json server ${name} entry does not exist yet: ${artifactPath}. Build it first.`);
    }
  }
}

// On Windows the npm CLI is npm.cmd; execFileSync without a shell cannot
// resolve the .cmd extension (spawnSync npm ENOENT), so pick the shim there.
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(commandName, args, cwd, timeout) {
  execFileSync(commandName, args, {
    cwd,
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
  });
}

function assertLockfile(pkg) {
  const dir = repoPath(pkg.path);
  const lockRel = `${pkg.path}/${pkg.lockfile}`;
  if (!existsSync(repoPath(lockRel))) {
    fail(`Missing lockfile: ${lockRel}`);
    return;
  }
  try {
    JSON.parse(readFileSync(repoPath(lockRel), 'utf8'));
  } catch (error) {
    fail(`${lockRel} is not JSON npm ci can accept: ${error instanceof Error ? error.message : error}`);
    return;
  }
  try {
    run(npmCommand, ['ci', '--ignore-scripts', '--dry-run', '--no-audit', '--no-fund'], dir, 180000);
  } catch (error) {
    const detail = `${error.stderr || error.stdout || error.message || error}`.trim().split('\n').slice(-8).join('\n');
    fail(`${pkg.path} lockfile is not acceptable to npm ci: ${detail}`);
  }
}

function assertBuildInput(pkg) {
  const entryRel = `${pkg.path}/${pkg.build_entry}`;
  const entry = repoPath(entryRel);
  if (!existsSync(entry) || !statSync(entry).isFile()) {
    fail(`Missing build input: ${entryRel}`);
    return;
  }
  const text = readFileSync(entry, 'utf8');
  if (!text.trim()) {
    fail(`Build input is empty or damaged: ${entryRel}`);
    return;
  }
  if (entryRel.endsWith('.ts')) {
    if (!text.includes('async function main')) {
      fail(`Build input no longer has a startup entry (async function main): ${entryRel}`);
    }
    const tsc = repoPath(`${pkg.path}/node_modules/typescript/bin/tsc`);
    if (!existsSync(tsc)) {
      fail(`Cannot verify ${pkg.path} rebuildability; run npm ci in ${pkg.path} first (typescript is missing).`);
      return;
    }
    try {
      run(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.json'], repoPath(pkg.path), 180000);
    } catch (error) {
      const detail = `${error.stdout || ''}${error.stderr || error.message || error}`.trim().split('\n').slice(-12).join('\n');
      fail(`${pkg.path} build input failed tsc --noEmit: ${detail}`);
    }
    return;
  }
  try {
    run(process.execPath, ['scripts/check.mjs'], repoPath(pkg.path), 60000);
  } catch (error) {
    const detail = `${error.stdout || ''}${error.stderr || error.message || error}`.trim().split('\n').slice(-12).join('\n');
    fail(`${pkg.path} build input check failed: ${detail}`);
  }
}

const manifest = readJson('bundle-manifest.json');
assertStructure(manifest);
const recorded = assertManifest(manifest);
assertArtifacts(recorded.artifacts);
assertMcpResolution(recorded.artifacts);
for (const pkg of recorded.packages) {
  assertLockfile(pkg);
  assertBuildInput(pkg);
}

if (failures.length) {
  throw new Error(`Workbench check failed:\n- ${failures.join('\n- ')}`);
}
process.stdout.write('Workbench check passed: structure, manifest inventory, build artifacts, lockfiles, and build inputs are rebuildable.\n');
process.stdout.write('Dist entries are not built by check. Produce them with: cd runtime && npm run build; cd fulltext-runtime && npm run build.\n');
