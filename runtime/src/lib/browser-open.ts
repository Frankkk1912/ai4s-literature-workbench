import { spawn, type ChildProcess } from 'node:child_process';

type SpawnFn = (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;

export interface OpenInBrowserOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: SpawnFn;
  /** How long to wait for the launcher to fail before assuming it worked. */
  settleMs?: number;
}

const LOOPBACK_PAGE = /^http:\/\/(127\.0\.0\.1|\[::1\]):\d+\//;

/**
 * Open a loopback page in the user's default browser. Resolves true when the
 * launcher started and did not fail straight away; that is a good sign, not proof
 * that a window appeared. Resolves false when there is nothing to launch with
 * (no display, no launcher, opt-out), so the caller can fall back to a typed code.
 *
 * Only loopback http URLs are accepted: the URL carries a one-time token, and this
 * function must never hand it, or any other address, to a launcher on someone's say-so.
 */
export async function openInBrowser(url: string, options: OpenInBrowserOptions = {}): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const spawnImpl: SpawnFn = options.spawnImpl ?? (spawn as unknown as SpawnFn);
  const settleMs = options.settleMs ?? 1500;

  if (!LOOPBACK_PAGE.test(url)) return false;
  if (env.AI4S_NO_BROWSER?.trim() === '1') return false;

  let command: string;
  let args: string[];
  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    // rundll32 takes the URL as one argument and involves no shell, so nothing in
    // the URL is interpreted by cmd.exe.
    command = 'rundll32';
    args = ['url.dll,FileProtocolHandler', url];
  } else {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
    command = 'xdg-open';
    args = [url];
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child: ChildProcess;
    try {
      child = spawnImpl(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => finish(true), settleMs);
    child.once('error', () => finish(false));
    child.once('exit', (code) => finish(code === 0 || code === null));
    child.unref();
  });
}
