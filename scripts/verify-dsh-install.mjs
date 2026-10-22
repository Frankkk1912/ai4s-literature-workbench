#!/usr/bin/env node
// Installs the DeepSeek Harness package into a scratch profile with a pinned `dsh`, the same
// command a user without Desktop would type (`dsh plugin --profile web add <tarball>`), then
// checks the installed copy: the profile lists it, its patch paths exist inside the profile,
// and both servers start from their patch rows.
//
//   node scripts/verify-dsh-install.mjs <path-to-tgz> [--dsh <version>]
//
// Needs the network (npm fetches dsh and its dependencies, a few hundred MB on a cold cache).
// The home folder and DSH_HOME are scratch folders, so nothing on the computer is touched.
// It proves the package installs and mounts under that dsh. It does not run a model, and it
// does not prove that Desktop's Add plugin page or Electron's Node behave the same way.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectPackage, startServers } from './verify-dsh-plugin.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Pinned: a new release of dsh must not change this check. Raise it on purpose, with engines.dsh.
export const PINNED_DSH = '0.2.1-rc.2';
const PACKAGE_NAME = 'dsh-ai4s-literature-workbench';

/** Problems with an installed profile, empty when the package is installed and works. */
export async function checkProfile(profileDir, { pluginVersion, workDir }) {
  const installed = join(profileDir, 'node_modules', PACKAGE_NAME);
  if (!existsSync(join(installed, 'package.json'))) return [`${PACKAGE_NAME} is not installed in ${profileDir}.`];
  const problems = [];
  const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
  if (!profileManifest.dsh?.profile?.bundles?.includes(PACKAGE_NAME)) problems.push('The profile does not list the package among its bundles, so dsh would not load its patch.');
  problems.push(...await inspectPackage(installed, { pluginVersion, profileDir }));
  if (problems.length === 0) problems.push(...await startServers(installed, { profileDir, workDir }));
  return problems;
}

function listTree(dir, depth) {
  if (!existsSync(dir)) return `${dir} does not exist`;
  const lines = [];
  const walk = (current, level) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      lines.push(`${'  '.repeat(level)}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      if (entry.isDirectory() && level < depth) walk(join(current, entry.name), level + 1);
    }
  };
  walk(dir, 0);
  return lines.join('\n');
}

// dsh 0.2.1-rc.2 declares Node 22.19 or newer. Below that it exits 0 without installing, so say so first.
const [major, minor] = process.versions.node.split('.').map(Number);
const NODE_OK = major > 22 || (major === 22 && minor >= 19);

async function main() {
  if (!NODE_OK) {
    process.stdout.write(`FAIL  dsh needs Node.js 22.19 or newer; this is ${process.versions.node}. Older versions exit without installing.\n`);
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const archiveArg = args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--dsh');
  const dshVersion = args.includes('--dsh') ? args[args.indexOf('--dsh') + 1] : PINNED_DSH;
  if (!archiveArg) {
    process.stderr.write('usage: node scripts/verify-dsh-install.mjs <path-to-tgz> [--dsh <version>]\n');
    process.exit(1);
  }
  const archive = resolve(archiveArg);
  const work = mkdtempSync(join(tmpdir(), 'ai4s-dsh-install-'));
  const home = join(work, 'home');
  const dshHome = join(work, 'dsh');
  mkdirSync(home, { recursive: true });
  let ok = false;
  try {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const run = spawnSync(npx, ['--yes', `@deepseek-ai/dsh@${dshVersion}`, 'plugin', '--profile', 'web', 'add', archive], {
      cwd: work,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: { ...process.env, HOME: home, USERPROFILE: home, DSH_HOME: dshHome },
      timeout: 15 * 60_000,
    });
    if (run.status !== 0) {
      process.stdout.write(`FAIL  dsh ${dshVersion} could not install the package (exit ${run.status ?? run.error?.message})\n${`${run.stdout}\n${run.stderr}`.trim().split(/\r?\n/).slice(-30).join('\n').replace(/^/gm, '      ')}\n`);
    } else {
      const pluginVersion = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
      const problems = await checkProfile(join(dshHome, 'profiles', 'web'), { pluginVersion, workDir: work });
      ok = problems.length === 0;
      process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  dsh ${dshVersion} installs the package into a scratch profile and both servers start from the installed copy\n`);
      if (!ok) {
        process.stdout.write(`${problems.join('\n').replace(/^/gm, '      ')}\n`);
        // What dsh printed and what it left in the profile, so a failure on another system can be read from the log.
        process.stdout.write(`      dsh said:\n${`${run.stdout}\n${run.stderr}`.trim().split(/\r?\n/).slice(-40).join('\n').replace(/^/gm, '        ')}\n`);
        process.stdout.write(`      profile folder:\n${listTree(join(dshHome, 'profiles'), 3).replace(/^/gm, '        ')}\n`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (!ok && process.env.GITHUB_ACTIONS === 'true') process.stdout.write('::error title=DeepSeek Harness install check failed::see the lines above\n');
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
