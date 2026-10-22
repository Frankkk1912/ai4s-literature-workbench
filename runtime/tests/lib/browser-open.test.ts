import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { openInBrowser } from '../../src/lib/browser-open.js';

const PAGE = 'http://127.0.0.1:4321/admin/onboarding/#code=abc';

function fakeSpawn(behaviour: 'ok' | 'error' | 'exit1' | 'hang') {
  const calls: Array<{ command: string; args: string[] }> = [];
  const impl = (command: string, args: string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    queueMicrotask(() => {
      if (behaviour === 'error') child.emit('error', new Error('ENOENT'));
      if (behaviour === 'exit1') child.emit('exit', 1);
      if (behaviour === 'ok') child.emit('exit', 0);
    });
    return child as never;
  };
  return { calls, impl };
}

describe('openInBrowser', () => {
  it('uses the platform launcher and passes the URL as one argument', async () => {
    for (const [platform, command] of [['darwin', 'open'], ['win32', 'rundll32'], ['linux', 'xdg-open']] as const) {
      const spawn = fakeSpawn('ok');
      const opened = await openInBrowser(PAGE, { platform, env: { DISPLAY: ':0' }, spawnImpl: spawn.impl as never });
      expect(opened).toBe(true);
      expect(spawn.calls).toHaveLength(1);
      expect(spawn.calls[0]!.command).toBe(command);
      expect(spawn.calls[0]!.args.filter((arg) => arg === PAGE)).toHaveLength(1);
    }
  });

  it('refuses anything that is not a loopback page, so the token cannot be sent elsewhere', async () => {
    for (const url of [
      'https://example.com/#code=abc',
      'http://evil.test:4321/admin/onboarding/#code=abc',
      'http://127.0.0.1.evil.test:4321/#code=abc',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://127.0.0.1/no-port',
    ]) {
      const spawn = fakeSpawn('ok');
      expect(await openInBrowser(url, { platform: 'darwin', env: {}, spawnImpl: spawn.impl as never })).toBe(false);
      expect(spawn.calls).toHaveLength(0);
    }
  });

  it('negative control: the same function does launch for a loopback page', async () => {
    const spawn = fakeSpawn('ok');
    expect(await openInBrowser(PAGE, { platform: 'darwin', env: {}, spawnImpl: spawn.impl as never })).toBe(true);
    expect(spawn.calls).toHaveLength(1);
  });

  it('reports false when there is nothing to launch with', async () => {
    const none = fakeSpawn('ok');
    expect(await openInBrowser(PAGE, { platform: 'linux', env: {}, spawnImpl: none.impl as never })).toBe(false);
    expect(none.calls).toHaveLength(0);
    expect(await openInBrowser(PAGE, { platform: 'darwin', env: { AI4S_NO_BROWSER: '1' }, spawnImpl: none.impl as never })).toBe(false);
    expect(await openInBrowser(PAGE, { platform: 'darwin', env: {}, spawnImpl: fakeSpawn('error').impl as never })).toBe(false);
    expect(await openInBrowser(PAGE, { platform: 'linux', env: { DISPLAY: ':0' }, spawnImpl: fakeSpawn('exit1').impl as never })).toBe(false);
  });

  it('assumes success when the launcher is still running after the settle time', async () => {
    vi.useFakeTimers();
    const result = openInBrowser(PAGE, { platform: 'darwin', env: {}, spawnImpl: fakeSpawn('hang').impl as never, settleMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    expect(await result).toBe(true);
    vi.useRealTimers();
  });
});
