import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WosPlaywrightAdapter } from '../src/adapters/wos.js';
import { ChromiumInstaller, type InstallerDeps } from '../src/browser-install.js';
import type { BrowserConfig } from '../src/config.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'browser-install-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function deps(overrides: Partial<InstallerDeps> & { executable: string }): InstallerDeps {
  return {
    executablePath: () => overrides.executable,
    cliPath: overrides.cliPath ?? (() => '/fake/playwright-core/cli.js'),
    run: overrides.run ?? (async () => ({ code: 0, output: '' })),
  };
}

describe('ChromiumInstaller', () => {
  it('reports installed when the executable exists, without offering a download', () => {
    const executable = join(tempDir(), 'chrome');
    writeFileSync(executable, '');
    const status = new ChromiumInstaller(true, deps({ executable })).status();
    expect(status).toMatchObject({ required: true, installed: true, state: 'installed' });
  });

  it('tells the agent to ask the user first when the browser is missing', () => {
    const status = new ChromiumInstaller(true, deps({ executable: join(tempDir(), 'missing') })).status();
    expect(status).toMatchObject({ required: true, installed: false, can_install: true, state: 'not_installed' });
    expect(status.message).toMatch(/ask the user first/i);
  });

  it('says a download is not needed when the user brings their own Chrome', () => {
    const installer = new ChromiumInstaller(false, deps({ executable: join(tempDir(), 'missing') }));
    expect(installer.status()).toMatchObject({ required: false, can_install: false, state: 'not_required' });
  });

  it('returns at once, shows downloading, then installed, and runs the CLI only once', async () => {
    const executable = join(tempDir(), 'chrome');
    const calls: string[] = [];
    let finish!: () => void;
    const installer = new ChromiumInstaller(true, deps({
      executable,
      run: (cli) => new Promise((resolve) => {
        calls.push(cli);
        finish = () => {
          writeFileSync(executable, '');
          resolve({ code: 0, output: '' });
        };
      }),
    }));
    expect(installer.install().state).toBe('downloading');
    expect(installer.install().state).toBe('downloading');
    expect(installer.status()).toMatchObject({ state: 'downloading', installed: false });
    // The browser file appears before the download command exits: still downloading.
    writeFileSync(executable, '');
    expect(installer.status()).toMatchObject({ state: 'downloading', installed: false });
    finish();
    await vi.waitFor(() => expect(installer.status().state).toBe('installed'));
    expect(calls).toEqual(['/fake/playwright-core/cli.js']);
    expect(installer.install().state).toBe('installed');
    expect(calls).toHaveLength(1);
  });

  it('reports a failed download with the tail of its output and allows a retry', async () => {
    const executable = join(tempDir(), 'chrome');
    let attempts = 0;
    const installer = new ChromiumInstaller(true, deps({
      executable,
      run: async () => {
        attempts += 1;
        return { code: 1, output: 'getaddrinfo ENOTFOUND cdn.playwright.dev' };
      },
    }));
    installer.install();
    await vi.waitFor(() => expect(installer.status().state).toBe('failed'));
    expect(installer.status().message).toContain('ENOTFOUND');
    expect(installer.install().state).toBe('downloading');
    await vi.waitFor(() => expect(installer.status().state).toBe('failed'));
    expect(attempts).toBe(2);
  });

  it('does not claim success when the CLI exits 0 but the browser is still missing', async () => {
    const installer = new ChromiumInstaller(true, deps({ executable: join(tempDir(), 'missing') }));
    installer.install();
    await vi.waitFor(() => expect(installer.status().state).toBe('failed'));
    expect(installer.status().installed).toBe(false);
  });

  it('points to the source route when the Playwright CLI is not on disk', () => {
    let ran = false;
    const installer = new ChromiumInstaller(true, deps({
      executable: join(tempDir(), 'missing'),
      cliPath: () => undefined,
      run: async () => { ran = true; return { code: 0, output: '' }; },
    }));
    const outcome = installer.install();
    expect(ran).toBe(false);
    expect(outcome.state).toBe('not_installed');
    expect(outcome.message).toMatch(/INSTALL\.md/);
  });

  it('does nothing when the user brings their own Chrome', () => {
    let ran = false;
    const installer = new ChromiumInstaller(false, deps({
      executable: join(tempDir(), 'missing'),
      run: async () => { ran = true; return { code: 0, output: '' }; },
    }));
    expect(installer.install().state).toBe('not_required');
    expect(ran).toBe(false);
  });
});

describe('first use of the Playwright adapter', () => {
  const config: BrowserConfig = {
    dataDir: '/unused', channel: 'chromium', cdpEndpoint: 'http://127.0.0.1:9222',
    headless: false, idleTtlMinutes: 30, diagnosticRetentionDays: 7,
  };

  it('stops with BROWSER_NOT_INSTALLED before launching anything', async () => {
    const adapter = new WosPlaywrightAdapter(config, new ChromiumInstaller(true, deps({ executable: join(tempDir(), 'missing') })));
    const session = await adapter.openSession();
    expect(session).toMatchObject({ sessionState: 'unavailable', errorCode: 'BROWSER_NOT_INSTALLED', userActionRequired: true });
    expect(session.message).toMatch(/ask the user first/i);
  });
});
