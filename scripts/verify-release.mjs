#!/usr/bin/env node
// Checks the release assets written by scripts/package-release.mjs, from the files a user
// would download rather than from the repository:
//   1. every asset matches SHA256SUMS.txt
//   2. the plugin archive, extracted into a temp folder, runs both bundles over stdio
//      (the same checks as scripts/verify-bundles.mjs --plugin-dir)
//   3. the double-click launchers in the extracted archive run the bundle with --setup and
//      exit 0 (scripts/verify-launchers.mjs); the archive still leaves out the
//      developer-only scripts/onboard.mjs and scripts/bootstrap.mjs
//   4. the Zotero .mcpb, started as its manifest says with an unset optional key,
//      lists the 24 workbench tools; the fulltext .mcpb starts from an unrelated cwd
//      and lists the exact six fulltext tools
//
//   node scripts/verify-release.mjs <release-dir>
//
// Needs `unzip` on Linux and macOS; Windows uses the bsdtar that ships with it.
import { spawnCommand } from './spawn-command.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseArg = process.argv[2];
if (!releaseArg) {
  process.stderr.write('usage: node scripts/verify-release.mjs <release-dir>\n');
  process.exit(1);
}
const releaseDir = resolve(releaseArg);
const work = mkdtempSync(join(tmpdir(), 'ai4s-release-verify-'));
const failures = [];
const version = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const zoteroMcpbName = `ai4s-literature-zotero-${version}.mcpb`;
const fulltextMcpbName = `ai4s-literature-fulltext-${version}.mcpb`;
const EXPECTED_FULLTEXT_TOOLS = [
  'fulltext_access_status',
  'fulltext_capabilities',
  'fulltext_fetch_submit',
  'fulltext_job_cancel',
  'fulltext_job_status',
  'fulltext_session_open',
];

function report(name, ok, detail = '') {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}\n`);
  if (!ok) {
    failures.push(name);
    if (detail) process.stdout.write(`${detail.replace(/^/gm, '      ')}\n`);
    if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::error title=Release check failed::${name}\n`);
  }
}

async function check(name, run) {
  try {
    await run();
    report(name, true);
  } catch (error) {
    report(name, false, error instanceof Error ? error.message : String(error));
  }
}

function extract(archive, into) {
  mkdirSync(into, { recursive: true });
  const result = process.platform === 'win32'
    ? spawnCommand('tar', ['-xf', archive, '-C', into], { encoding: 'utf8' })
    : spawnCommand('unzip', ['-q', archive, '-d', into], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not extract ${archive}: ${result.error?.message ?? result.stderr}`);
  }
}

function find(pattern) {
  const match = readdirSync(releaseDir).find((name) => pattern.test(name));
  if (!match) throw new Error(`No file matching ${pattern} in ${releaseDir}.`);
  return join(releaseDir, match);
}

try {
  await check('checksums match every release asset', () => {
    const lines = readFileSync(join(releaseDir, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
    const listed = new Set();
    for (const line of lines) {
      const [hash, name] = [line.slice(0, 64), line.slice(66)];
      listed.add(name);
      const actual = createHash('sha256').update(readFileSync(join(releaseDir, name))).digest('hex');
      if (actual !== hash) throw new Error(`${name}: SHA256SUMS.txt says ${hash}, file is ${actual}.`);
    }
    for (const name of ['.zip', '.xpi']) {
      if (![...listed].some((entry) => entry.endsWith(name))) throw new Error(`SHA256SUMS.txt has no ${name} entry.`);
    }
    for (const name of [zoteroMcpbName, fulltextMcpbName]) {
      if (!listed.has(name) || !existsSync(join(releaseDir, name))) {
        throw new Error(`Required asset ${name} must exist and be listed in SHA256SUMS.txt.`);
      }
    }
  });

  await check('the Zotero add-on is attached under both names and the update feed describes it', async () => {
    const versioned = find(/^literature-metrics-\d+\.\d+\.\d+\.xpi$/);
    const bytes = readFileSync(versioned);
    if (!bytes.equals(readFileSync(join(releaseDir, 'literature-metrics.xpi')))) {
      throw new Error('literature-metrics.xpi is not the same file as the versioned add-on.');
    }
    const { checkFeed } = await import(pathToFileURL(join(repoRoot, 'literature-metrics', 'scripts', 'update-feed.mjs')).href);
    const problems = checkFeed({
      manifest: JSON.parse(readFileSync(join(repoRoot, 'literature-metrics', 'manifest.json'), 'utf8')),
      feed: JSON.parse(readFileSync(join(repoRoot, 'literature-metrics', 'update.json'), 'utf8')),
      xpiBytes: bytes,
    });
    if (problems.length > 0) throw new Error(problems.join(' '));
  });

  const pluginArchive = find(/^ai4s-literature-workbench-.*\.zip$/);
  const pluginParent = join(work, 'plugin');
  extract(pluginArchive, pluginParent);
  const pluginDir = join(pluginParent, readdirSync(pluginParent)[0]);

  await check('plugin archive carries a .mcp.json that points only at files inside it', () => {
    const mcp = JSON.parse(readFileSync(join(pluginDir, '.mcp.json'), 'utf8'));
    for (const [name, server] of Object.entries(mcp.mcpServers)) {
      for (const arg of server.args.filter((a) => a.startsWith('./'))) {
        if (!existsSync(resolve(pluginDir, server.cwd ?? '.', arg))) throw new Error(`${name}: ${arg} is not in the archive.`);
        if (arg.includes('/dist/')) throw new Error(`${name}: ${arg} still points at a dist/ build that the archive does not contain.`);
      }
    }
    if (existsSync(join(pluginDir, 'database-browser-runtime'))) throw new Error('The archive must not include database-browser-runtime.');
    if (existsSync(join(pluginDir, 'dsh-plugin'))) throw new Error('The archive must not include dsh-plugin.');
  });

  await check('Claude and CodeBuddy plugin MCP configs launch archive bundles from a scratch session', async () => {
    const sdk = join(repoRoot, 'runtime', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');
    const { Client } = await import(pathToFileURL(join(sdk, 'index.js')).href);
    const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'stdio.js')).href);
    const scratch = join(work, 'scratch-session');
    const home = join(work, 'plugin-home');
    mkdirSync(scratch, { recursive: true });
    mkdirSync(home, { recursive: true });
    const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, '.config') };
    for (const key of Object.keys(env)) if (/^(ZOTERO_|ZOTEUS_|LITERATURE_|PUBMED_|EASYSCHOLAR_|NODE_PATH$|NODE_OPTIONS$)/.test(key)) delete env[key];
    const projectServers = JSON.parse(readFileSync(join(pluginDir, '.mcp.json'), 'utf8')).mcpServers;
    for (const [host, variable] of [
      ['claude', '${CLAUDE_PLUGIN_ROOT}'],
      ['codebuddy', '${CODEBUDDY_PLUGIN_ROOT}'],
    ]) {
      const manifest = JSON.parse(readFileSync(join(pluginDir, `.${host}-plugin`, 'plugin.json'), 'utf8'));
      const servers = manifest.mcpServers;
      if (JSON.stringify(Object.keys(servers).sort()) !== JSON.stringify(Object.keys(projectServers).sort())) {
        throw new Error(`${host}: plugin MCP server names differ from .mcp.json.`);
      }
      const expand = (value) => value.replaceAll(variable, pluginDir);
      for (const [name, server] of Object.entries(servers)) {
        const expectedEntry = projectServers[name].args[0].replace(/^\./, variable);
        if (server.command !== 'node' || server.cwd !== variable || server.args.length !== 1 || server.args[0] !== expectedEntry || !expectedEntry.endsWith('/bundle/index.mjs')) {
          throw new Error(`${host}/${name}: expected plugin-root bundle args and cwd, got ${JSON.stringify(server)}.`);
        }
        for (const path of [expand(server.cwd), ...server.args.map(expand)]) {
          const rel = relative(pluginDir, path);
          if (!isAbsolute(path) || isAbsolute(rel) || rel.startsWith('..') || !existsSync(path)) {
            throw new Error(`${host}/${name}: ${path} is not an absolute path inside the archive.`);
          }
        }
        // Launch a wrapper from an unrelated cwd, then apply the host-expanded MCP
        // config exactly. An accidental ./ entry reproduces the desktop failure.
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: ['-e', `
            const { spawn } = require('node:child_process');
            const child = spawn(process.execPath, ${JSON.stringify(server.args.map(expand))}, {
              cwd: ${JSON.stringify(expand(server.cwd))}, stdio: 'inherit'
            });
            child.on('error', (error) => { console.error(error); process.exit(1); });
            child.on('exit', (code) => process.exit(code ?? 1));
            process.on('SIGTERM', () => child.kill());
          `],
          cwd: scratch,
          env: { ...env, ...server.env, ZOTEUS_LOCAL: 'off' },
          stderr: 'pipe',
        });
        let stderr = '';
        transport.stderr?.on('data', (chunk) => { stderr += chunk; });
        const client = new Client({ name: 'ai4s-plugin-path-verify', version: '0.1.0' });
        let timer;
        try {
          await Promise.race([
            (async () => {
              await client.connect(transport);
              const { tools } = await client.listTools();
              const expected = name.endsWith('-zotero') ? 'setup_status' : 'fulltext_capabilities';
              if (!tools.some((tool) => tool.name === expected)) throw new Error(`${host}/${name}: ${expected} missing.`);
            })(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${host}/${name}: timed out.`)), 60_000); }),
          ]);
        } catch (error) {
          throw new Error(`${error.message}\n${stderr}`);
        } finally {
          clearTimeout(timer);
          await client.close().catch(() => {});
        }
      }
    }
  });

  const bundleRun = spawnCommand(process.execPath, [join(repoRoot, 'scripts', 'verify-bundles.mjs'), '--plugin-dir', pluginDir], { encoding: 'utf8' });
  process.stdout.write(`${bundleRun.stdout.trimEnd().replace(/^/gm, '  [archive] ')}\n`);
  if (bundleRun.status === 0) {
    report('plugin archive bundles start and list their tools', true);
  } else {
    report('plugin archive bundles start and list their tools', false, bundleRun.stderr || 'see the [archive] lines above');
  }

  await check('the archive still omits the developer-only scripts', () => {
    for (const name of ['onboard.mjs', 'bootstrap.mjs']) {
      if (existsSync(join(pluginDir, 'scripts', name))) throw new Error(`scripts/${name} is developer-only and must not be in the archive.`);
    }
  });

  // The launchers are what a user double-clicks when the agent's sandbox cannot start a server
  // or a browser. They must run from the extracted folder, with no node_modules anywhere.
  const launcherRun = spawnCommand(process.execPath, [join(repoRoot, 'scripts', 'verify-launchers.mjs'), '--plugin-dir', pluginDir], { encoding: 'utf8' });
  process.stdout.write(`${launcherRun.stdout.trimEnd().replace(/^/gm, '  [archive] ')}\n`);
  report('plugin archive launchers run the bundle with --setup', launcherRun.status === 0, launcherRun.stderr || 'see the [archive] lines above');

  await check('Zotero .mcpb starts as its manifest says and lists the 24 workbench tools', async () => {
    const mcpbDir = join(work, 'mcpb');
    extract(join(releaseDir, zoteroMcpbName), mcpbDir);
    const manifest = JSON.parse(readFileSync(join(mcpbDir, 'manifest.json'), 'utf8'));
    // Substitute the way Claude Desktop does: defaults are filled in; an unset optional
    // value with no default stays as its literal ${user_config.x} text.
    const defaults = Object.fromEntries(
      Object.entries(manifest.user_config ?? {}).filter(([, v]) => v.default !== undefined).map(([k, v]) => [k, v.default]),
    );
    const substitute = (text) => text
      .replaceAll('${__dirname}', mcpbDir)
      .replace(/\$\{user_config\.([^}]+)\}/g, (whole, key) => (key in defaults ? String(defaults[key]) : whole));
    const { command, args = [], env = {} } = manifest.server.mcp_config;
    if (!Object.values(env).some((value) => substitute(value).includes('${user_config.'))) {
      throw new Error('Expected the manifest to have an optional setting with no default, to exercise the unset case.');
    }

    const sdk = join(repoRoot, 'runtime', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');
    const { Client } = await import(pathToFileURL(join(sdk, 'index.js')).href);
    const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'stdio.js')).href);
    const home = join(work, 'home');
    mkdirSync(home, { recursive: true });
    const childEnv = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, '.config') };
    for (const key of Object.keys(childEnv)) if (/^(ZOTERO_|ZOTEUS_|LITERATURE_)/.test(key)) delete childEnv[key];
    for (const [key, value] of Object.entries(env)) childEnv[key] = substitute(value);

    const transport = new StdioClientTransport({
      command: command === 'node' ? process.execPath : command,
      args: args.map(substitute),
      cwd: mcpbDir,
      env: { ...childEnv, ZOTEUS_LOCAL: 'off' },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => { stderr += chunk; });
    const client = new Client({ name: 'ai4s-release-verify', version: '0.1.0' });
    try {
      await Promise.race([client.connect(transport), new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out after 60s.')), 60_000))]);
      const { tools } = await client.listTools();
      if (tools.length !== 24) throw new Error(`Expected 24 tools, got ${tools.length}.`);
      const whoami = await client.callTool({ name: 'zotero_whoami', arguments: {} });
      const text = JSON.stringify(whoami);
      if (text.includes('user_config')) throw new Error(`The unset key reached the server as a real value: ${text.slice(0, 300)}`);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : error}${stderr ? `\nserver stderr:\n${stderr.trim()}` : ''}`);
    } finally {
      await client.close().catch(() => {});
    }
  });

  await check('fulltext .mcpb starts as its manifest says from an unrelated cwd and lists six tools', async () => {
    const mcpbDir = join(work, 'mcpb-fulltext');
    extract(join(releaseDir, fulltextMcpbName), mcpbDir);
    const manifest = JSON.parse(readFileSync(join(mcpbDir, 'manifest.json'), 'utf8'));
    if (manifest.name !== 'ai4s-literature-fulltext' || manifest.version !== version) {
      throw new Error('Fulltext manifest name or version does not match the release.');
    }
    const defaults = Object.fromEntries(
      Object.entries(manifest.user_config ?? {}).filter(([, v]) => v.default !== undefined).map(([k, v]) => [k, v.default]),
    );
    const substitute = (text) => text
      .replaceAll('${__dirname}', mcpbDir)
      .replace(/\$\{user_config\.([^}]+)\}/g, (whole, key) => (key in defaults ? String(defaults[key]) : whole));
    const { command, args = [], env = {} } = manifest.server.mcp_config;
    const sdk = join(repoRoot, 'runtime', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');
    const { Client } = await import(pathToFileURL(join(sdk, 'index.js')).href);
    const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'stdio.js')).href);
    const home = join(work, 'fulltext-home');
    const scratch = join(work, 'fulltext-scratch');
    mkdirSync(home, { recursive: true });
    mkdirSync(scratch, { recursive: true });
    const childEnv = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, '.config') };
    for (const key of Object.keys(childEnv)) if (/^(ZOTERO_|ZOTEUS_|LITERATURE_|NODE_PATH$|NODE_OPTIONS$)/.test(key)) delete childEnv[key];
    for (const [key, value] of Object.entries(env)) childEnv[key] = substitute(value);
    const transport = new StdioClientTransport({
      command: command === 'node' ? process.execPath : command,
      args: args.map(substitute),
      cwd: scratch,
      env: childEnv,
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => { stderr += chunk; });
    const client = new Client({ name: 'ai4s-fulltext-release-verify', version: '0.1.0' });
    let timer;
    try {
      await Promise.race([
        (async () => {
          await client.connect(transport);
          const { tools } = await client.listTools();
          const actual = tools.map((tool) => tool.name).sort();
          if (JSON.stringify(actual) !== JSON.stringify([...EXPECTED_FULLTEXT_TOOLS].sort())) {
            throw new Error(`Expected six fulltext tools, got ${actual.join(', ')}.`);
          }
          const capabilities = await client.callTool({ name: 'fulltext_capabilities', arguments: {} });
          if (capabilities.isError) throw new Error('fulltext_capabilities returned an error.');
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out after 60s.')), 60_000); }),
      ]);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : error}${stderr ? `\nserver stderr:\n${stderr.trim()}` : ''}`);
    } finally {
      clearTimeout(timer);
      await client.close().catch(() => {});
    }
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} release check(s) failed.\n`);
  process.exit(1);
}
process.stdout.write('\nAll release checks passed.\n');
