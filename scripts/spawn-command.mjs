import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Windows spawn rules for this repository.
//
// Node joins `shell: true` arguments with spaces and hands the line to
// cmd.exe (`/d /s /c`). A checkout or script path that contains a space is
// then split, so `node.exe` tries to load `C:\Users\Frank\AI4S` and exits
// with "Cannot find module". Characters outside the active code page can be
// rewritten on that same trip through cmd.exe. CreateProcessW does neither:
// each argument stays intact, including non-ASCII paths.
//
// The exception is a .cmd/.bat shim. Node refuses to spawn those directly
// (CVE-2024-27980, EINVAL). npm and npx are shims, so they run as
// `node npm-cli.js` when that file is next to this Node, which keeps their
// arguments off cmd.exe as well. Only a shim we cannot find as JavaScript
// goes through cmd.exe, and then every argument is quoted.

const BATCH = /\.(?:cmd|bat)$/i;
const CMD_META = /[\s\t"&|<>^()!%]/;
const resolvedCache = new Map();
let npmBinDir;

/** Quote one argument for `cmd.exe /d /s /c`. The caller wraps the whole line in one more pair of quotes, which `/s` strips. */
export function quoteCmdArg(arg) {
  if (typeof arg !== 'string') throw new TypeError('command arguments must be strings');
  if (/[\0\r\n]/.test(arg)) throw new Error('command arguments cannot contain newlines');
  if (arg.length === 0) return '""';
  // cmd.exe splits on spaces and treats & | < > ^ ( ) ! % as syntax.
  // Paths do not contain `"`. `""` is how cmd keeps a literal quote.
  // A backslash is an ordinary character here, so it is not doubled.
  if (!CMD_META.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/** The single `/c` argument: outer quotes are removed by `cmd /s` and the inner quotes stay. */
export function cmdCommandLine(command, args) {
  return `"${[command, ...args].map((arg) => quoteCmdArg(arg)).join(' ')}"`;
}

function npmTool(command) {
  const base = command.replace(/^.*[\\/]/, '');
  const match = /^(npm|npx)(?:\.cmd)?$/i.exec(base);
  return match ? match[1].toLowerCase() : null;
}

function npmCli(tool) {
  if (npmBinDir === undefined) {
    const root = dirname(process.execPath);
    const candidates = [
      join(root, 'node_modules', 'npm', 'bin'),
      join(root, 'lib', 'node_modules', 'npm', 'bin'),
      join(root, '..', 'lib', 'node_modules', 'npm', 'bin'),
    ];
    npmBinDir = candidates.find((dir) => existsSync(join(dir, 'npm-cli.js'))) ?? null;
  }
  if (!npmBinDir) return null;
  const script = join(npmBinDir, `${tool}-cli.js`);
  return existsSync(script) ? script : null;
}

function hasPath(command) {
  return /[\\/]/.test(command);
}

/**
 * Full path of a bare command, preferring a real .exe over a .cmd shim.
 * PowerShell returns the path as text, so a non-ASCII install directory is
 * not decoded through the console code page. `where.exe` writes that page.
 */
function resolveOnWindows(name) {
  if (resolvedCache.has(name)) return resolvedCache.get(name);
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const nameB64 = Buffer.from(name, 'utf16le').toString('base64');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$name = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${nameB64}'))`,
    '$apps = @(Get-Command -Name $name -All -CommandType Application -ErrorAction SilentlyContinue)',
    'if ($apps.Count -eq 0) { exit 1 }',
    '$pick = $null',
    'foreach ($app in $apps) {',
    "  if ($app.Source -and $app.Source.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) { $pick = $app.Source; break }",
    '}',
    'if (-not $pick) { $pick = $apps[0].Source }',
    'if (-not $pick) { exit 1 }',
    '[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($pick)))',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  let resolved = null;
  if (result.status === 0 && result.stdout) {
    try {
      const path = Buffer.from(result.stdout.trim(), 'base64').toString('utf16le').trim();
      resolved = path || null;
    } catch {
      resolved = null;
    }
  }
  resolvedCache.set(name, resolved);
  return resolved;
}

function windowsPlan(command) {
  // The Node that is already running. Never look it up, and never via cmd.
  if (/^node(?:\.exe)?$/i.test(command) || command === process.execPath) {
    return { kind: 'direct', command: process.execPath };
  }
  // A named .exe (cmd.exe, tar.exe, where.exe) is not a batch shim. Node
  // quotes its arguments for CreateProcessW, which keeps spaces and non-ASCII.
  if (/\.exe$/i.test(command)) return { kind: 'direct', command };
  const tool = npmTool(command);
  if (tool) {
    const script = npmCli(tool);
    if (script) return { kind: 'node', script };
    const resolved = hasPath(command) ? command : resolveOnWindows(tool);
    return { kind: 'cmd', command: resolved || `${tool}.cmd` };
  }
  if (BATCH.test(command)) return { kind: 'cmd', command };
  if (hasPath(command)) return { kind: 'direct', command };
  const resolved = resolveOnWindows(command);
  if (resolved && BATCH.test(resolved)) return { kind: 'cmd', command: resolved };
  if (resolved && /\.exe$/i.test(resolved)) return { kind: 'direct', command: resolved };
  return { kind: 'direct', command };
}

function withoutShell(options) {
  const rest = { ...options };
  // Callers cannot opt back into an unquoted shell. That is the bug.
  delete rest.shell;
  delete rest.windowsVerbatimArguments;
  return rest;
}

/**
 * `spawnSync`, but a path with spaces or non-ASCII characters stays one
 * argument. On Windows, npm/npx run under this Node when their JavaScript
 * entry exists; other .cmd/.bat shims run through a quoted `cmd.exe` line.
 * Everything else, including `process.execPath`, is spawned directly.
 */
export function spawnCommand(command, args = [], options = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('args must be an array of strings');
  }
  const rest = withoutShell(options);
  if (process.platform !== 'win32') {
    return spawnSync(command, args, { ...rest, shell: false });
  }
  const plan = windowsPlan(command);
  if (plan.kind === 'node') {
    return spawnSync(process.execPath, [plan.script, ...args], { ...rest, shell: false });
  }
  if (plan.kind === 'cmd') {
    // `cmd.exe` is looked up on PATH. ComSpec is often an absolute path; with
    // windowsVerbatimArguments that path would be concatenated unquoted, so a
    // space in it would split the command line. `cmd.exe` itself has none.
    return spawnSync('cmd.exe', ['/d', '/s', '/c', cmdCommandLine(plan.command, args)], {
      ...rest,
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(plan.command, args, { ...rest, shell: false });
}
