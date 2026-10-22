#!/usr/bin/env node
// Runs the double-click launchers (Setup AI4S.bat on Windows, Setup AI4S.command elsewhere)
// the way a user's double-click would, from a folder with no node_modules above it.
// Run `npm run bundle` in runtime/ first.
//
//   node scripts/verify-launchers.mjs [--plugin-dir <folder>]
//
// With --plugin-dir, checks the launchers inside an already-extracted plugin archive
// (scripts/verify-release.mjs does this). Without it, copies release/launchers/ and
// runtime/bundle/ from this repository into a temp folder.
//
// Checks: both launchers are present, the .command keeps its execute bit, the launcher
// runs the bundle with --setup and prints the page address, and (negative control) the
// launcher stops and points to nodejs.org when Node.js is not on the PATH.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function report(name, ok, detail = '') {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}\n`);
  if (!ok) {
    failures.push(name);
    if (detail) process.stdout.write(`${detail.replace(/^/gm, '      ')}\n`);
    if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::error title=Launcher check failed::${name}\n`);
  }
}

function check(name, run) {
  try {
    run();
    report(name, true);
  } catch (error) {
    report(name, false, error instanceof Error ? error.message : String(error));
  }
}

const flag = process.argv.indexOf('--plugin-dir');
const given = flag === -1 ? undefined : process.argv[flag + 1];
if (flag !== -1 && !given) {
  process.stderr.write('verify-launchers: --plugin-dir needs a folder.\n');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'ai4s-launcher-verify-'));
const pluginDir = given ? resolve(given) : join(work, 'plugin');

try {
  if (!given) {
    if (!existsSync(join(repoRoot, 'runtime', 'bundle', 'index.mjs'))) {
      throw new Error('Missing runtime/bundle/index.mjs. Run "npm run bundle" in runtime/ first.');
    }
    mkdirSync(pluginDir, { recursive: true });
    cpSync(join(repoRoot, 'release', 'launchers'), pluginDir, { recursive: true });
    cpSync(join(repoRoot, 'runtime', 'bundle'), join(pluginDir, 'runtime', 'bundle'), { recursive: true });
  }
  for (let current = pluginDir; ; current = dirname(current)) {
    if (existsSync(join(current, 'node_modules'))) {
      throw new Error(`${current} has a node_modules folder, so this run would not prove the bundle is self-contained.`);
    }
    if (current === parse(current).root) break;
  }

  const isWindows = process.platform === 'win32';
  const launcherName = isWindows ? 'Setup AI4S.bat' : 'Setup AI4S.command';

  // No developer settings, no browser, no waiting for a key press.
  function runLauncher(extraEnv) {
    const env = { ...process.env, AI4S_NO_BROWSER: '1', AI4S_NO_PAUSE: '1', ...extraEnv };
    for (const key of Object.keys(env)) if (/^(ZOTERO_|ZOTEUS_|LITERATURE_|NODE_PATH$|NODE_OPTIONS$)/.test(key)) delete env[key];
    const file = join(pluginDir, launcherName);
    return isWindows
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', `""${file}" --check"`], { cwd: pluginDir, env, encoding: 'utf8', windowsVerbatimArguments: true, timeout: 60_000 })
      : spawnSync(file, ['--check'], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 60_000 });
  }

  check('both launchers are present, and the .command can be opened from Finder', () => {
    for (const name of ['Setup AI4S.bat', 'Setup AI4S.command']) {
      if (!existsSync(join(pluginDir, name))) throw new Error(`${name} is missing.`);
    }
    if (!isWindows && (statSync(join(pluginDir, 'Setup AI4S.command')).mode & 0o111) === 0) {
      throw new Error('Setup AI4S.command has no execute bit, so double-clicking it in Finder would not run it.');
    }
  });

  check(`${launcherName} runs the bundle with --setup and prints the page address`, () => {
    const run = runLauncher({});
    if (run.error || run.status !== 0) {
      throw new Error(`${launcherName} exited with ${run.status ?? run.error?.message}.\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
    }
    if (!/http:\/\/127\.0\.0\.1:\d+\/admin\/onboarding\//.test(run.stdout)) {
      throw new Error(`${launcherName} did not print the page address:\n${run.stdout}`);
    }
  });

  check('negative control: the launcher stops and says so when Node.js is not installed', () => {
    // A PATH with no node in it: only the system folders.
    const systemPath = isWindows ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin';
    const [command, args] = isWindows ? ['cmd.exe', ['/d', '/c', 'where node']] : ['sh', ['-c', 'command -v node']];
    const probe = spawnSync(command, args, { env: { ...process.env, PATH: systemPath }, encoding: 'utf8' });
    if (probe.status === 0) {
      process.stdout.write('      (skipped: this machine has Node.js in its system folders, so the launcher cannot be run without it)\n');
      return;
    }
    const run = runLauncher({ PATH: systemPath });
    if (run.status === 0 || !/nodejs\.org/.test(run.stdout)) {
      throw new Error(`Expected a non-zero exit and a pointer to nodejs.org, got status ${run.status}:\n${run.stdout}`);
    }
  });
} catch (error) {
  report('set-up', false, error instanceof Error ? error.message : String(error));
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} launcher check(s) failed.\n`);
  process.exit(1);
}
process.stdout.write('\nAll launcher checks passed.\n');
