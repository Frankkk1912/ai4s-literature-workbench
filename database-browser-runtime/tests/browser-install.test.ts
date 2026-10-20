import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(status).toMatchObject({ required: true, installed: true });
  });

  it('tells the agent to ask the user first when the browser is missing', () => {
    const status = new ChromiumInstaller(true, deps({ executable: join(tempDir(), 'missing') })).status();
    expect(status).toMatchObject({ required: true, installed: false, can_install: true });
    expect(status.message).toMatch(/ask the user first/i);
  });

  it('says a download is not needed when the user brings their own Chrome', () => {
    const installer = new ChromiumInstaller(false, deps({ executable: join(tempDir(), 'missing') }));
    expect(installer.status()).toMatchObject({ required: false, can_install: false });
  });

  it('runs the Playwright CLI once and reports success only if the file then exists', async () => {
    const executable = join(tempDir(), 'chrome');
    const calls: string[] = [];
    const installer = new ChromiumInstaller(true, deps({
      executable,
      run: async (cli) => {
        calls.push(cli);
        writeFileSync(executable, '');
        return { code: 0, output: '' };
      },
    }));
    const [first, second] = await Promise.all([installer.install(), installer.install()]);
    expect(first.installed).toBe(true);
    expect(second).toBe(first);
    expect(calls).toEqual(['/fake/playwright-core/cli.js']);
    expect((await installer.install()).message).toMatch(/already installed/);
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
    const outcome = await installer.install();
    expect(outcome.installed).toBe(false);
    expect(outcome.message).toContain('ENOTFOUND');
    await installer.install();
    expect(attempts).toBe(2);
  });

  it('does not claim success when the CLI exits 0 but the browser is still missing', async () => {
    const installer = new ChromiumInstaller(true, deps({ executable: join(tempDir(), 'missing') }));
    expect((await installer.install()).installed).toBe(false);
  });

  it('points to the source route when the Playwright CLI is not on disk', async () => {
    let ran = false;
    const installer = new ChromiumInstaller(true, deps({
      executable: join(tempDir(), 'missing'),
      cliPath: () => undefined,
      run: async () => { ran = true; return { code: 0, output: '' }; },
    }));
    const outcome = await installer.install();
    expect(ran).toBe(false);
    expect(outcome.message).toMatch(/INSTALL\.md/);
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
