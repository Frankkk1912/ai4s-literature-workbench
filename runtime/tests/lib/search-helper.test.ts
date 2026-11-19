import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UV_ASSETS,
  UV_VERSION,
  extractWithTar,
  installSearchHelper,
  probeSearchHelper,
  resetSearchHelperInstall,
  runCommandFor,
  startSearchHelperInstall,
  tarCommand,
  workbenchUvPath,
  type ExecResult,
  type SearchHelperDeps,
} from '../../src/lib/search-helper.js';

const FAKE_ARCHIVE = new TextEncoder().encode('pretend this is uv');
const fakeSha = createHash('sha256').update(FAKE_ARCHIVE).digest('hex');

function makeDeps(overrides: Partial<SearchHelperDeps> = {}) {
  const toolsDir = mkdtempSync(join(tmpdir(), 'ai4s-uv-'));
  const calls: string[][] = [];
  let fetches = 0;
  const deps: SearchHelperDeps = {
    platform: 'darwin',
    arch: 'arm64',
    toolsDir,
    assets: { 'darwin-arm64': { name: 'uv-aarch64-apple-darwin.tar.gz', sha256: fakeSha, size: FAKE_ARCHIVE.byteLength } },
    fetch: (async () => {
      fetches += 1;
      return new Response(FAKE_ARCHIVE, { status: 200 });
    }) as typeof fetch,
    // The real archives hold `uv-<target>/uv` (tar.gz) or `uv.exe` at the top (zip).
    extract: async (_archive, dest) => {
      mkdirSync(join(dest, 'uv-aarch64-apple-darwin'));
      writeFileSync(join(dest, 'uv-aarch64-apple-darwin', 'uv'), 'binary');
      writeFileSync(join(dest, 'uv-aarch64-apple-darwin', 'uvx'), 'binary');
    },
    exec: async (file, args): Promise<ExecResult> => {
      calls.push([file, ...args]);
      if (args[0] === '--version') return { code: existsSync(file) || file === 'uv' ? 0 : null, stdout: `uv ${UV_VERSION}`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    sleep: async () => {},
    ...overrides,
  };
  return { deps, toolsDir, calls, fetches: () => fetches };
}

afterEach(() => resetSearchHelperInstall());

describe('pinned uv release table', () => {
  it('covers Windows, macOS and Linux on both chips, each with a full SHA-256', () => {
    expect(Object.keys(UV_ASSETS).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
    for (const asset of Object.values(UV_ASSETS)) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.name).toMatch(/^uv-[a-z0-9_-]+\.(tar\.gz|zip)$/);
      expect(asset.size).toBeGreaterThan(5_000_000);
    }
    expect(new Set(Object.values(UV_ASSETS).map((a) => a.sha256)).size).toBe(6);
    expect(UV_ASSETS['win32-x64']!.name.endsWith('.zip')).toBe(true);
    expect(UV_ASSETS['linux-x64']!.name).toContain('musl');
  });

  it('keeps each version in its own folder', () => {
    expect(workbenchUvPath('/t', 'darwin')).toBe(join('/t', `uv-${UV_VERSION}`, 'uv'));
    expect(workbenchUvPath('/t', 'win32')).toBe(join('/t', `uv-${UV_VERSION}`, 'uv.exe'));
  });

  it('names the System32 tar on Windows, so a Git tar on PATH cannot pick up the .zip', () => {
    expect(tarCommand('win32', { SystemRoot: 'C:\\WINDOWS' })).toBe('C:\\WINDOWS\\System32\\tar.exe');
    expect(tarCommand('darwin', {})).toBe('tar');
  });
});

describe('runCommandFor', () => {
  it('quotes a path with spaces and quotes for each shell', () => {
    const run = runCommandFor("/Users/o'neil/Library/Application Support/uv");
    expect(run.posix).toBe(`'/Users/o'\\''neil/Library/Application Support/uv' run`);
    expect(run.powershell).toBe(`& '/Users/o''neil/Library/Application Support/uv' run`);
    const sh = spawnSync('sh', ['-c', `printf '%s' ${run.posix.slice(0, -4)}`], { encoding: 'utf8' });
    if (process.platform !== 'win32') expect(sh.stdout).toBe("/Users/o'neil/Library/Application Support/uv");
  });

  it('is plain `uv run` for a uv the user already has', () => {
    expect(runCommandFor(null)).toEqual({ posix: 'uv run', powershell: 'uv run' });
  });
});

describe('probeSearchHelper', () => {
  it('prefers the workbench copy, then PATH, and never downloads', async () => {
    const { deps, toolsDir } = makeDeps();
    let fetched = false;
    deps.fetch = (async () => {
      fetched = true;
      throw new Error('no');
    }) as typeof fetch;

    expect(await probeSearchHelper(deps)).toMatchObject({ available: true, source: 'path', path: null });

    const own = workbenchUvPath(toolsDir, 'darwin');
    mkdirSync(join(own, '..'), { recursive: true });
    writeFileSync(own, 'x');
    expect(await probeSearchHelper(deps)).toMatchObject({ available: true, source: 'workbench', path: own });
    expect(fetched).toBe(false);
  });

  it('reports no helper, and whether one can be installed', async () => {
    const { deps } = makeDeps({ exec: async () => ({ code: null, stdout: '', stderr: 'ENOENT' }) });
    expect(await probeSearchHelper(deps)).toEqual({ available: false, source: null, path: null, run: null, can_install: true });
    expect((await probeSearchHelper({ ...deps, arch: 'ia32' })).can_install).toBe(false);
  });
});

describe('installSearchHelper', () => {
  it('downloads, checks, unpacks into its own folder, and makes sure Python is there', async () => {
    const { deps, toolsDir, calls } = makeDeps();
    const phases: string[] = [];
    const result = await installSearchHelper(deps, (state) => phases.push(state));
    const target = workbenchUvPath(toolsDir, 'darwin');
    expect(result).toMatchObject({ state: 'installed', python_ready: true, path: target });
    expect(result.run?.posix).toBe(`'${target}' run`);
    expect(phases).toEqual(['downloading', 'preparing_python']);
    expect(readFileSync(target, 'utf8')).toBe('binary');
    // Only the finished folder is left: no download, no half-unpacked copy, no uvx.
    expect(readdirSync(toolsDir)).toEqual([`uv-${UV_VERSION}`]);
    expect(readdirSync(join(toolsDir, `uv-${UV_VERSION}`))).toEqual(['uv']);
    expect(calls.some((c) => c[1] === 'python' && c[2] === 'find')).toBe(true);
    expect(calls.some((c) => c[1] === 'python' && c[2] === 'install')).toBe(false);
  });

  it('refuses a file whose checksum does not match, and leaves nothing behind', async () => {
    const { deps, toolsDir } = makeDeps({
      fetch: (async () => new Response(new TextEncoder().encode('tampered'), { status: 200 })) as typeof fetch,
    });
    const result = await installSearchHelper(deps);
    expect(result.state).toBe('failed');
    expect(result.error).toMatch(/checksum/);
    expect(existsSync(workbenchUvPath(toolsDir, 'darwin'))).toBe(false);
    expect(existsSync(toolsDir) ? readdirSync(toolsDir) : []).toEqual([]);
  });

  it('retries a dropped connection, then gives a plain reason', async () => {
    let attempts = 0;
    const flaky = makeDeps({
      fetch: (async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('SSL_ERROR_SYSCALL');
        return new Response(FAKE_ARCHIVE, { status: 200 });
      }) as typeof fetch,
    });
    expect((await installSearchHelper(flaky.deps)).state).toBe('installed');
    expect(attempts).toBe(3);

    const down = makeDeps({ fetch: (async () => new Response('', { status: 503 })) as typeof fetch });
    const result = await installSearchHelper(down.deps);
    expect(result).toMatchObject({ state: 'failed' });
    expect(result.error).toMatch(/GitHub.*503/);
  });

  it('fetches Python only when none is found, and still counts uv as installed if that fails', async () => {
    const calls: string[][] = [];
    const { deps } = makeDeps({
      exec: async (file, args) => {
        calls.push(args);
        if (args[0] === '--version') return { code: 0, stdout: `uv ${UV_VERSION}`, stderr: '' };
        return { code: 2, stdout: '', stderr: 'no python' };
      },
    });
    const result = await installSearchHelper(deps);
    expect(result).toMatchObject({ state: 'installed', python_ready: false });
    // No link in ~/.local/bin and no Windows registry entry: only uv's own folder changes.
    expect(calls).toContainEqual(['python', 'install', '--no-bin', '--no-registry', '3.12']);
  });

  it('does not download again when the pinned copy is already there', async () => {
    const first = makeDeps();
    await installSearchHelper(first.deps);
    await installSearchHelper(first.deps);
    expect(first.fetches()).toBe(1);
  });

  it('says so on a system with no ready-made build', async () => {
    const { deps } = makeDeps({ platform: 'freebsd' });
    expect(await installSearchHelper(deps)).toMatchObject({ state: 'unsupported' });
  });

  it('rejects a helper that does not start', async () => {
    const { deps } = makeDeps({ exec: async () => ({ code: 1, stdout: '', stderr: 'bad CPU type' }) });
    const result = await installSearchHelper(deps);
    expect(result.state).toBe('failed');
    expect(result.error).toMatch(/does not start/);
  });
});

describe('startSearchHelperInstall', () => {
  it('joins an install already running, and retries one that failed', async () => {
    let fail = true;
    const { deps } = makeDeps({
      fetch: (async () => (fail ? new Response('', { status: 500 }) : new Response(FAKE_ARCHIVE, { status: 200 }))) as typeof fetch,
    });
    const a = startSearchHelperInstall(deps);
    expect(startSearchHelperInstall(deps)).toBe(a);
    expect((await a.promise).state).toBe('failed');
    fail = false;
    const b = startSearchHelperInstall(deps);
    expect(b).not.toBe(a);
    expect((await b.promise).state).toBe('installed');
  });
});

describe.skipIf(process.platform === 'win32')('extractWithTar (real tar, real archive layout)', () => {
  it('unpacks a .tar.gz shaped like the uv release and the result runs', async () => {
    const work = mkdtempSync(join(tmpdir(), 'ai4s-uv-tar-'));
    const inner = join(work, 'src', 'uv-aarch64-apple-darwin');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, 'uv'), `#!/bin/sh\necho "uv ${UV_VERSION}"\n`, { mode: 0o755 });
    const archive = join(work, 'uv.tar.gz');
    expect(spawnSync('tar', ['-czf', archive, '-C', join(work, 'src'), 'uv-aarch64-apple-darwin']).status).toBe(0);
    const bytes = readFileSync(archive);
    const sha = createHash('sha256').update(bytes).digest('hex');

    const toolsDir = join(work, 'tools');
    const key = `${process.platform}-${process.arch}`;
    const result = await installSearchHelper({
      ...makeDeps().deps,
      platform: process.platform,
      arch: process.arch,
      toolsDir,
      assets: { [key]: { name: 'uv.tar.gz', sha256: sha, size: bytes.byteLength } },
      fetch: (async () => new Response(bytes, { status: 200 })) as typeof fetch,
      extract: extractWithTar,
      exec: async (file, args) => {
        if (args[0] !== '--version') return { code: 0, stdout: '', stderr: '' };
        const run = spawnSync(file, args, { encoding: 'utf8' });
        return { code: run.status, stdout: run.stdout, stderr: run.stderr };
      },
    });
    expect(result.state).toBe('installed');
  });
});
