import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

export interface BrowserInstallStatus {
  browser: 'chromium';
  /** False when the configured channel is the user's own Chrome or an existing CDP session. */
  required: boolean;
  installed: boolean;
  /** True when this install can download it itself (the Playwright CLI is on disk). */
  can_install: boolean;
  message: string;
}

export interface BrowserInstallResult {
  installed: boolean;
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

const DOWNLOAD_NOTE = 'a one-time download of roughly 150 MB or more';
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
 * have asked the user first. One install runs at a time; callers share its result.
 */
export class ChromiumInstaller {
  private inFlight: Promise<BrowserInstallResult> | undefined;

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
    if (!this.required) {
      return {
        browser: 'chromium', required: false, installed: false, can_install: false,
        message: 'This setup uses your own Chrome or an existing Chrome session, so no browser download is needed.',
      };
    }
    const installed = this.isInstalled();
    const canInstall = this.deps.cliPath() !== undefined;
    return {
      browser: 'chromium', required: true, installed, can_install: canInstall,
      message: installed
        ? 'The browser is installed.'
        : canInstall
          ? `The browser is not installed yet. Installing it is ${DOWNLOAD_NOTE}. Ask the user first; only if they agree, call database_browser_install.`
          : 'The browser is not installed, and this copy cannot download it by itself because the Playwright command is missing. Use the source install route described in INSTALL.md.',
    };
  }

  install(): Promise<BrowserInstallResult> {
    this.inFlight ??= this.doInstall().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async doInstall(): Promise<BrowserInstallResult> {
    if (!this.required) return { installed: false, message: this.status().message };
    if (this.isInstalled()) return { installed: true, message: 'The browser is already installed.' };
    const cli = this.deps.cliPath();
    if (!cli) return { installed: false, message: this.status().message };
    const { code, output } = await this.deps.run(cli);
    if (code === 0 && this.isInstalled()) return { installed: true, message: 'The browser was downloaded and is ready.' };
    const tail = output.trim().split(/\r?\n/).slice(-6).join('\n');
    return {
      installed: false,
      message: `The browser download did not finish (exit code ${code ?? 'none'}). Check the network connection and try again.${tail ? `\n${tail}` : ''}`,
    };
  }
}
