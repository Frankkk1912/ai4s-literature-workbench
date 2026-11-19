import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultToolsDir } from './paths.js';

// The search and Zotero-manager skills run two standard-library Python scripts. `uv` is the
// launcher that supplies Python for them, without admin rights. A beginner does not have it,
// so the workbench downloads one pinned release itself, checks it against the SHA-256 below,
// and keeps it in its own folder. If the computer has no Python 3.10 or newer, uv fetches one
// into its own per-user folder. No admin rights, nothing added to PATH, no registry entries.
//
// To move to a newer uv: pick a release at least two weeks old, and copy each asset's
// `digest` and `size` from `gh api repos/astral-sh/uv/releases/tags/<version>`.

export const UV_VERSION = '0.13.7';

export interface UvAsset {
  name: string;
  sha256: string;
  size: number;
}

/** Keyed by `${process.platform}-${process.arch}`. Linux uses the static musl build, which runs on any distribution. */
export const UV_ASSETS: Readonly<Record<string, UvAsset>> = {
  'darwin-arm64': { name: 'uv-aarch64-apple-darwin.tar.gz', sha256: '81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731', size: 14347867 },
  'darwin-x64': { name: 'uv-x86_64-apple-darwin.tar.gz', sha256: '20c47e4c1f630b8abaff8c291fa9b9aa300fef92c4fbff95adf198b55287cda7', size: 17026382 },
  'win32-x64': { name: 'uv-x86_64-pc-windows-msvc.zip', sha256: '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021', size: 15236317 },
  'win32-arm64': { name: 'uv-aarch64-pc-windows-msvc.zip', sha256: '505d9e65e7692bac3ddf98c66754aa26c5050c409c184af30a881a0a72cc85e3', size: 15538425 },
  'linux-x64': { name: 'uv-x86_64-unknown-linux-musl.tar.gz', sha256: '287491da03f2a785c70fa75b13e1f849918c2f2b5415fe84876b8214eeb792f9', size: 18396915 },
  'linux-arm64': { name: 'uv-aarch64-unknown-linux-musl.tar.gz', sha256: '2d3ec076a0c4c0e8250bb6418c44080828b544f1a3be0b6e46adf9fb6923de45', size: 16888574 },
};

const DOWNLOAD_BASE = 'https://github.com/astral-sh/uv/releases/download';
/** Python the scripts are run with when the computer has no suitable one. */
const PYTHON_REQUEST = '>=3.10';
const PYTHON_INSTALL = '3.12';
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 3;
const PYTHON_TIMEOUT_MS = 10 * 60_000;
/** How long the install tool waits before answering "still downloading" and letting it finish in the background. */
export const INSTALL_WAIT_MS = 40_000;

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface SearchHelperDeps {
  platform: NodeJS.Platform;
  arch: string;
  toolsDir: string;
  /** The pinned release table; tests swap in their own. */
  assets: Readonly<Record<string, UvAsset>>;
  fetch: typeof fetch;
  exec: (file: string, args: string[], timeoutMs: number) => Promise<ExecResult>;
  /** Unpacks a .tar.gz or .zip into `dest`. */
  extract: (archive: string, dest: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}

function defaultExec(file: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    try {
      // No shell: the program and its arguments are fixed by this file, never by a caller.
      execFile(
        file,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, UV_NO_PROGRESS: '1' } },
        (error, stdout, stderr) => {
          // execFile puts the exit status in `code`; a string there (ENOENT) means it never ran.
          const raw = (error as { code?: unknown } | null)?.code;
          const code = !error ? 0 : typeof raw === 'number' ? raw : null;
          resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (error ? error.message : '') });
        },
      );
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: (error as Error).message });
    }
  });
}

/**
 * The system `tar`: bsdtar on macOS and on Windows 10 1803 or later (which also reads .zip),
 * GNU tar on Linux. On Windows the System32 copy is named explicitly, because a Git for
 * Windows `tar` earlier on PATH cannot read .zip files.
 */
export function tarCommand(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform !== 'win32') return 'tar';
  const root = env.SystemRoot?.trim() || env.windir?.trim() || 'C:\\Windows';
  return `${root}\\System32\\tar.exe`;
}

export async function extractWithTar(archive: string, dest: string): Promise<void> {
  const result = await defaultExec(tarCommand(), ['-xf', archive, '-C', dest], 120_000);
  if (result.code !== 0) throw new Error(`could not unpack the download (${result.stderr.trim().slice(0, 200) || 'tar failed'})`);
}

export function defaultDeps(env: NodeJS.ProcessEnv = process.env): SearchHelperDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    toolsDir: defaultToolsDir(env),
    assets: UV_ASSETS,
    fetch: globalThis.fetch.bind(globalThis),
    exec: defaultExec,
    extract: extractWithTar,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function assetFor(platform: string, arch: string, assets: Readonly<Record<string, UvAsset>> = UV_ASSETS): UvAsset | undefined {
  return assets[`${platform}-${arch}`];
}

/** Where the pinned copy lives once installed. The version is in the folder name, so an upgrade never mixes files. */
export function workbenchUvPath(toolsDir: string, platform: NodeJS.Platform): string {
  return join(toolsDir, `uv-${UV_VERSION}`, platform === 'win32' ? 'uv.exe' : 'uv');
}

export interface RunCommand {
  /** For bash and zsh (macOS, Linux, Git Bash). */
  posix: string;
  /** For Windows PowerShell and PowerShell 7. */
  powershell: string;
}

/** The words that replace `uv run` in the skills' commands, quoted for each shell. */
export function runCommandFor(path: string | null): RunCommand {
  if (!path) return { posix: 'uv run', powershell: 'uv run' };
  return {
    posix: `'${path.replace(/'/g, `'\\''`)}' run`,
    powershell: `& '${path.replace(/'/g, "''")}' run`,
  };
}

export interface HelperProbe {
  available: boolean;
  /** `workbench`: the copy this workbench downloaded. `path`: a uv the user already had. */
  source: 'workbench' | 'path' | null;
  path: string | null;
  run: RunCommand | null;
  /** The workbench can download its own copy on this computer. */
  can_install: boolean;
}

/** Find a working uv: the workbench's own copy first, then one on PATH. Never downloads anything. */
export async function probeSearchHelper(deps: SearchHelperDeps = defaultDeps(), timeoutMs = 4000): Promise<HelperProbe> {
  const canInstall = Boolean(assetFor(deps.platform, deps.arch, deps.assets));
  const own = workbenchUvPath(deps.toolsDir, deps.platform);
  if (existsSync(own)) {
    const result = await deps.exec(own, ['--version'], timeoutMs);
    if (result.code === 0) return { available: true, source: 'workbench', path: own, run: runCommandFor(own), can_install: canInstall };
  }
  const onPath = await deps.exec('uv', ['--version'], timeoutMs);
  if (onPath.code === 0) return { available: true, source: 'path', path: null, run: runCommandFor(null), can_install: canInstall };
  return { available: false, source: null, path: null, run: null, can_install: canInstall };
}

export type InstallState = 'not_installed' | 'downloading' | 'preparing_python' | 'installed' | 'failed' | 'unsupported';

export interface InstallResult {
  state: InstallState;
  /** True once Python for the scripts is ready too; false means the first search fetches it. */
  python_ready: boolean;
  path: string | null;
  run: RunCommand | null;
  /** Plain-language reason, for a failure. */
  error?: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function download(deps: SearchHelperDeps, asset: UvAsset): Promise<Uint8Array> {
  const url = `${DOWNLOAD_BASE}/${UV_VERSION}/${asset.name}`;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await deps.fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`the download server answered ${response.status}`);
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > MAX_DOWNLOAD_BYTES) throw new Error('the download is far larger than expected');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error('the download is far larger than expected');
      return bytes;
    } catch (error) {
      lastError = error as Error;
      if (attempt < DOWNLOAD_ATTEMPTS) await deps.sleep(1000 * attempt * attempt);
    }
  }
  throw new Error(`could not download the helper from GitHub (${lastError?.message ?? 'no answer'})`);
}

function findBinary(dir: string, name: string, depth = 2): string | undefined {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isFile() && entry === name) return full;
    if (stats.isDirectory() && depth > 0) {
      const found = findBinary(full, name, depth - 1);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Make sure a Python the scripts can use is there. If not, uv fetches one into its own
 * per-user folder, where a later `uv run` from the agent's shell finds it. `--no-bin` and
 * `--no-registry` stop uv from also adding a `python3.x` link to ~/.local/bin or writing the
 * Windows registry, so nothing outside those folders changes.
 */
async function ensurePython(deps: SearchHelperDeps, uv: string): Promise<boolean> {
  const found = await deps.exec(uv, ['python', 'find', PYTHON_REQUEST], 30_000);
  if (found.code === 0) return true;
  const installed = await deps.exec(uv, ['python', 'install', '--no-bin', '--no-registry', PYTHON_INSTALL], PYTHON_TIMEOUT_MS);
  return installed.code === 0;
}

/**
 * Download, verify and unpack the pinned uv, then make sure Python is available.
 * `onProgress` reports the phase, so a caller that stopped waiting can still answer.
 */
export async function installSearchHelper(
  deps: SearchHelperDeps = defaultDeps(),
  onProgress: (state: InstallState) => void = () => {},
): Promise<InstallResult> {
  const asset = assetFor(deps.platform, deps.arch, deps.assets);
  const target = workbenchUvPath(deps.toolsDir, deps.platform);
  const fail = (error: string): InstallResult => ({ state: 'failed', python_ready: false, path: null, run: null, error });
  if (!asset) {
    return { state: 'unsupported', python_ready: false, path: null, run: null, error: `no helper build for ${deps.platform} ${deps.arch}` };
  }

  if (!existsSync(target)) {
    onProgress('downloading');
    let bytes: Uint8Array;
    try {
      bytes = await download(deps, asset);
    } catch (error) {
      return fail((error as Error).message);
    }
    // The checksum is the trust anchor: a mismatch is never retried or accepted.
    if (sha256(bytes) !== asset.sha256) return fail('the downloaded file did not match its expected checksum, so it was not used');

    mkdirSync(deps.toolsDir, { recursive: true });
    const stamp = `${process.pid}-${Date.now()}`;
    const archive = join(deps.toolsDir, `${asset.name}.${stamp}.download`);
    const staging = join(deps.toolsDir, `uv-${UV_VERSION}.${stamp}.partial`);
    try {
      writeFileSync(archive, bytes, { mode: 0o600 });
      mkdirSync(staging, { recursive: true });
      await deps.extract(archive, staging);
      const exe = deps.platform === 'win32' ? 'uv.exe' : 'uv';
      const found = findBinary(staging, exe);
      if (!found) return fail('the download did not contain the helper program');
      const finalDir = join(deps.toolsDir, `uv-${UV_VERSION}`);
      const flat = join(staging, '.ready');
      mkdirSync(flat);
      renameSync(found, join(flat, exe));
      if (deps.platform !== 'win32') chmodSync(join(flat, exe), 0o755);
      // Another install may have finished first; keep whichever copy is already in place.
      if (!existsSync(finalDir)) renameSync(flat, finalDir);
    } catch (error) {
      return fail((error as Error).message);
    } finally {
      rmSync(archive, { force: true });
      rmSync(staging, { recursive: true, force: true });
    }
  }

  const version = await deps.exec(target, ['--version'], 15_000);
  if (version.code !== 0 || !version.stdout.includes(UV_VERSION)) {
    return fail(`the helper was unpacked but does not start (${(version.stderr || version.stdout).trim().slice(0, 200) || 'no output'})`);
  }

  onProgress('preparing_python');
  const pythonReady = await ensurePython(deps, target);
  return { state: 'installed', python_ready: pythonReady, path: target, run: runCommandFor(target) };
}

// --- One install per process, which a caller may stop waiting for. ---

interface Running {
  state: InstallState;
  promise: Promise<InstallResult>;
  result?: InstallResult;
}

let running: Running | undefined;

/** Start the install, or join the one already going. A finished failure is retried. */
export function startSearchHelperInstall(deps: SearchHelperDeps = defaultDeps()): Running {
  if (running && (!running.result || running.result.state === 'installed')) return running;
  const entry: Running = { state: 'downloading', promise: Promise.resolve(undefined as never) };
  entry.promise = installSearchHelper(deps, (state) => {
    entry.state = state;
  }).then((result) => {
    entry.state = result.state;
    entry.result = result;
    return result;
  });
  running = entry;
  return entry;
}

/** The install going on in this process, if any; setup_status uses it to say "downloading". */
export function currentSearchHelperInstall(): { state: InstallState; result?: InstallResult } | undefined {
  return running ? { state: running.state, result: running.result } : undefined;
}

/** For tests only. */
export function resetSearchHelperInstall(): void {
  running = undefined;
}
