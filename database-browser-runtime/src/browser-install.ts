import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

export type BrowserInstallState = 'not_required' | 'not_installed' | 'downloading' | 'installed' | 'failed';

export interface BrowserInstallStatus {
  browser: 'chromium';
  state: BrowserInstallState;
  /** False when the configured channel is the user's own Chrome or an existing CDP session. */
  required: boolean;
  installed: boolean;
  /** True when this install can download it itself (the Playwright CLI is on disk). */
  can_install: boolean;
  message: string;
}

export interface BrowserInstallResult {
  state: BrowserInstallState;
  message: string;
}

export interface InstallerDeps {
  /** Where Playwright expects its Chromium. The file may not exist yet. */
  executablePath: () => string | undefined;
  /** Path to playwright-core's cli.js, or undefined when it is not installed. */
  cliPath: () => string | undefined;
  /** Runs `node cli.js install chromium` and resolves with its exit code and trailing output. */
  run: (cli: string) => Promise<{ code: number | null; output: string }>;
}

const DOWNLOAD_NOTE = 'a one-time download of a few hundred MB (about 540 MB on disk on macOS)';
const INSTALL_TIMEOUT_MS = 15 * 60_000;

function defaultExecutablePath(): string | undefined {
  try {
    return chromium.executablePath() || undefined;
  } catch {
    return undefined;
  }
}

function defaultCliPath(): string | undefined {
  try {
    const manifest = createRequire(import.meta.url).resolve('playwright-core/package.json');
    const cli = join(dirname(manifest), 'cli.js');
    return existsSync(cli) ? cli : undefined;
  } catch {
    return undefined;
  }
}

function defaultRun(cli: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    // No shell and no user-supplied arguments: the browser name is fixed.
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: error.message });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/**
 * First-use download of Playwright's Chromium. It never runs on its own: the caller must
 * have asked the user first.
 *
 * The download takes minutes, longer than an MCP request is usually allowed to run, so
 * install() only starts it. Callers poll status(). One download runs at a time.
 */
export class ChromiumInstaller {
  private running = false;
  private failure: string | undefined;

  constructor(
    private readonly required: boolean,
    private readonly deps: InstallerDeps = {
      executablePath: defaultExecutablePath,
      cliPath: defaultCliPath,
      run: defaultRun,
    },
  ) {}

  isInstalled(): boolean {
    const path = this.deps.executablePath();
    return path !== undefined && existsSync(path);
  }

  status(): BrowserInstallStatus {
    const canInstall = this.deps.cliPath() !== undefined;
    const base = { browser: 'chromium' as const, required: this.required, can_install: canInstall };
    if (!this.required) {
      return {
        ...base, state: 'not_required', installed: false, can_install: false,
        message: 'This setup uses your own Chrome or an existing Chrome session, so no browser download is needed.',
      };
    }
    if (this.isInstalled()) {
      return { ...base, state: 'installed', installed: true, message: 'The browser is installed.' };
    }
    if (this.running) {
      return {
        ...base, state: 'downloading', installed: false,
        message: 'The browser is downloading. This takes a few minutes. Call database_browser_install_status again later; do not start another download.',
      };
    }
    if (this.failure) {
      return {
        ...base, state: 'failed', installed: false,
        message: `${this.failure}\nTell the user, and if they want to try again, call database_browser_install again.`,
      };
    }
    return {
      ...base, state: 'not_installed', installed: false,
      message: canInstall
        ? `The browser is not installed yet. Installing it is ${DOWNLOAD_NOTE}. Ask the user first; only if they agree, call database_browser_install.`
        : 'The browser is not installed, and this copy cannot download it by itself because the Playwright command is missing. Use the source install route described in INSTALL.md.',
    };
  }

  /** Starts the download if needed and returns at once with the current state. */
  install(): BrowserInstallResult {
    const before = this.status();
    if (before.state !== 'not_installed' && before.state !== 'failed') {
      return { state: before.state, message: before.message };
    }
    const cli = this.deps.cliPath();
    if (!cli) return { state: before.state, message: before.message };
    this.running = true;
    this.failure = undefined;
    void this.download(cli);
    return {
      state: 'downloading',
      message: 'The download has started and takes a few minutes. Call database_browser_install_status to see when it is done.',
    };
  }

  private async download(cli: string): Promise<void> {
    try {
      const { code, output } = await this.deps.run(cli);
      if (!(code === 0 && this.isInstalled())) {
        const tail = output.trim().split(/\r?\n/).slice(-6).join('\n');
        this.failure = `The browser download did not finish (exit code ${code ?? 'none'}). Check the network connection.${tail ? `\n${tail}` : ''}`;
      }
    } catch (error) {
      this.failure = `The browser download could not start: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.running = false;
    }
  }
}
