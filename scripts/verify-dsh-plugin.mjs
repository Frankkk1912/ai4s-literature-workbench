#!/usr/bin/env node
// Checks the DeepSeek Harness plugin package (dsh-ai4s-literature-workbench-<version>.tgz) the
// way a user receives it: unpacked into a profile folder's node_modules, with its patch read
// the way DeepSeek Harness reads it.
//
//   node scripts/verify-dsh-plugin.mjs <path-to-tgz>
//
// What this proves, and what it does not:
//   proves   the package is well formed, every path its patch mounts exists inside it, the
//            patch's own expressions give the paths and commands claimed, both servers start
//            from those commands in a folder with no repository around them and list their
//            exact tools, and the skills carry the name and description DeepSeek Harness asks for
//   does not prove that DeepSeek Harness (or its Desktop app) loads the package; that is
//            scripts/verify-dsh-install.mjs, run against a pinned dsh, and the manual test
//
// The checks are plain functions (exported) so tests/dsh-plugin.test.mjs can feed them a broken
// package and see them fail.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_NAME = 'dsh-ai4s-literature-workbench';
const read = (path) => readFileSync(path, 'utf8');
const nodeRequire = (spec) => import(pathToFileURL(join(repoRoot, 'runtime', 'node_modules', spec)).href);

// js-yaml is what DeepSeek Harness itself reads patches with. It comes with the runtime's
// dev dependencies, like the MCP client below.
async function loadYaml() {
  const mod = await nodeRequire('js-yaml/dist/js-yaml.mjs');
  return mod.default ?? mod;
}

/** The patch with each `!!js` scalar left as { js: <source> } so it can be evaluated later. */
export async function parsePatch(text) {
  const yaml = await loadYaml();
  const jsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => ({ js: String(data) }) });
  return yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend([jsType]) });
}

/**
 * Evaluates the patch's `!!js` expressions with the same inputs the real loader gives them: no
 * `require`, a `ctx.get('profileContext').dir`, and the process. The expressions are ours and
 * only reach this function from a package we just built.
 */
function evaluate(value, ctx) {
  if (Array.isArray(value)) return value.map((item) => evaluate(item, ctx));
  if (value && typeof value === 'object') {
    if (typeof value.js === 'string' && Object.keys(value).length === 1) {
      return new Function('ctx', 'process', `"use strict"; return (${value.js});`)(ctx, process);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, evaluate(item, ctx)]));
  }
  return value;
}

/** The rows a patch inserts, with every expression evaluated for a profile folder. */
export async function patchRows(packageDir, profileDir) {
  const manifest = JSON.parse(read(join(packageDir, 'package.json')));
  const patchPath = manifest.dsh?.bundle?.patch;
  if (typeof patchPath !== 'string') throw new Error('package.json has no dsh.bundle.patch.');
  if (!existsSync(join(packageDir, patchPath))) throw new Error(`dsh.bundle.patch points at ${patchPath}, which is not in the package.`);
  const ctx = { get: (name) => (name === 'profileContext' ? { dir: profileDir } : undefined) };
  const patch = evaluate(await parsePatch(read(join(packageDir, patchPath))), ctx);
  if (!Array.isArray(patch)) throw new Error('The patch is not a list of operations.');
  return patch.flatMap((operation) => operation.insert ?? []);
}

/** Frontmatter of a SKILL.md as DeepSeek Harness needs it: name and description. */
export async function skillFrontmatter(path) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(path));
  if (!match) return {};
  const yaml = await loadYaml();
  return yaml.load(match[1]) ?? {};
}

const toList = (source, marker) => {
  const start = source.indexOf(marker);
  const open = source.indexOf('[', start);
  return [...source.slice(open, source.indexOf(']', open)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};
/** The exact tool lists scripts/verify-bundles.mjs asserts, so there is one place to change them. */
export function expectedTools() {
  const source = read(join(repoRoot, 'scripts', 'verify-bundles.mjs'));
  return { runtime: toList(source, 'const EXPECTED_RUNTIME_TOOLS'), fulltext: toList(source, 'const EXPECTED_FULLTEXT_TOOLS') };
}

/**
 * Static checks on an unpacked package folder. `profileDir` is where the package sits as
 * profileDir/node_modules/<name>. Returns a list of problems, empty when the package is sound.
 */
export async function inspectPackage(packageDir, { pluginVersion, profileDir }) {
  const problems = [];
  const manifestPath = join(packageDir, 'package.json');
  if (!existsSync(manifestPath)) return ['package.json is missing.'];
  const manifest = JSON.parse(read(manifestPath));

  if (manifest.name !== PACKAGE_NAME) problems.push(`The package is named ${manifest.name}, expected ${PACKAGE_NAME}. The patch builds paths from that name.`);
  if (manifest.version !== pluginVersion) problems.push(`The package is version ${manifest.version} but the plugin is ${pluginVersion}.`);
  if (typeof manifest.engines?.dsh !== 'string') problems.push('package.json has no engines.dsh range, so an incompatible DeepSeek Harness would load it.');
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    if (!existsSync(join(packageDir, file))) problems.push(`${file} is missing.`);
  }

  // Nothing that is build input, a test, or a secret belongs in what users download.
  const stack = [packageDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const name = relative(packageDir, path).split(sep).join('/');
      if (entry.isDirectory()) {
        if (/^(node_modules|tests|__pycache__|\.git)$/.test(entry.name)) problems.push(`${name}/ must not be in the package.`);
        else stack.push(path);
      } else if (/(^|\/)(\.env.*|.*\.pyc|.*\.pem|.*\.key|zotero-api-key.*)$/i.test(name)) {
        problems.push(`${name} must not be in the package.`);
      }
    }
  }

  let rows = [];
  try {
    rows = await patchRows(packageDir, profileDir);
  } catch (error) {
    problems.push(`The patch could not be read: ${error instanceof Error ? error.message : error}`);
    return problems;
  }
  const mcpRows = rows.filter((row) => row.name === '@deepseek-ai/dsh-mcp-client');
  const skillRows = rows.filter((row) => row.name === '@deepseek-ai/dsh-skill-filesystem');
  if (mcpRows.map((row) => row.config?.serverName).sort().join() !== 'ai4s-literature-fulltext,ai4s-literature-zotero') {
    problems.push('The patch should mount exactly the servers ai4s-literature-zotero and ai4s-literature-fulltext.');
  }
  if (skillRows.length !== 1) problems.push(`The patch should have one skills row, found ${skillRows.length}.`);

  const insideProfile = (path) => resolve(path).startsWith(resolve(profileDir, 'node_modules', PACKAGE_NAME));
  for (const row of mcpRows) {
    const { serverName, transport } = row.config ?? {};
    const args = row.config?.args ?? [];
    const env = row.config?.env ?? {};
    if (transport !== 'stdio') problems.push(`${serverName}: expected a stdio transport, got ${transport}.`);
    const entry = args[0];
    if (typeof entry !== 'string' || !insideProfile(entry) || !existsSync(entry)) problems.push(`${serverName}: its entry file ${entry} is not inside the package.`);
    // Desktop runs its Host on Electron, where this makes the binary behave as plain Node. It must stay.
    if (env.ELECTRON_RUN_AS_NODE !== '1') problems.push(`${serverName}: ELECTRON_RUN_AS_NODE is not set to "1".`);
    if (row.config?.command !== process.execPath) problems.push(`${serverName}: the command is not the host's own Node (process.execPath).`);
    for (const [key, value] of Object.entries(env)) {
      if (/key|token|secret|password/i.test(key) && value) problems.push(`${serverName}: the patch sets ${key}; keys never go in the package.`);
    }
  }

  for (const row of skillRows) {
    const dirs = row.config?.customSkillDirs ?? [];
    if (dirs.length !== 1 || !insideProfile(dirs[0]) || !existsSync(dirs[0])) {
      problems.push(`The skills row should point at one folder inside the package, got ${JSON.stringify(dirs)}.`);
      continue;
    }
    const skillNames = readdirSync(dirs[0], { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const expected = ['ai4s-setup', 'literature-manager', 'literature-research', 'literature-writing'];
    if (skillNames.join() !== expected.join()) problems.push(`Expected the skills ${expected.join(', ')}; found ${skillNames.join(', ') || '(none)'}.`);
    for (const name of skillNames) {
      const file = join(dirs[0], name, 'SKILL.md');
      if (!existsSync(file)) {
        problems.push(`skills/${name}/SKILL.md is missing.`);
        continue;
      }
      const meta = await skillFrontmatter(file);
      if (meta.name !== name) problems.push(`skills/${name}/SKILL.md has name "${meta.name}"; it must equal the folder name.`);
      if (typeof meta.description !== 'string' || meta.description.trim() === '') problems.push(`skills/${name}/SKILL.md has no description.`);
    }
  }
  return problems;
}

async function loadClient() {
  const sdk = join(repoRoot, 'runtime', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');
  const { Client } = await import(pathToFileURL(join(sdk, 'index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'stdio.js')).href);
  return { Client, StdioClientTransport };
}

/**
 * Starts one patch row exactly as written (command, args, env) and returns its tool names and
 * what it answered to `call`. The folder it runs in has no repository and no node_modules of its
 * own; `home` keeps the developer's real keys out of the run.
 */
export async function runRow(row, { home, cwd, use }) {
  const { Client, StdioClientTransport } = await loadClient();
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(ZOTERO_|ZOTEUS_|LITERATURE_|PUBMED_|EASYSCHOLAR_|NODE_PATH$|NODE_OPTIONS$)/.test(key)) delete env[key];
  }
  const transport = new StdioClientTransport({
    command: row.config.command,
    args: row.config.args,
    cwd,
    env: {
      ...env,
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      XDG_CONFIG_HOME: join(home, '.config'),
      AI4S_NO_BROWSER: '1',
      ...row.config.env,
      ZOTEUS_LOCAL: 'off',
      LITERATURE_FULLTEXT_DATA_DIR: join(home, 'fulltext', 'data'),
      LITERATURE_FULLTEXT_EXCHANGE_ROOT: join(home, 'fulltext', 'exchange'),
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk; });
  const client = new Client({ name: 'ai4s-dsh-verify', version: '0.1.0' });
  let timer;
  try {
    const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out after 60s.')), 60_000); });
    return await Promise.race([guard, (async () => {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const answer = use ? await use(client) : undefined;
      return { tools: tools.map((tool) => tool.name).sort(), answer };
    })()]);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}${stderr ? `\nserver stderr:\n${stderr.trim().slice(-1500)}` : ''}`);
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

export function sameTools(actual, expected) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) === JSON.stringify(e)) return [];
  return [`expected ${e.length} tools, got ${a.length}. Missing: ${e.filter((n) => !a.includes(n)).join(', ') || '(none)'}. Unexpected: ${a.filter((n) => !e.includes(n)).join(', ') || '(none)'}.`];
}

/**
 * What the first-run flow needs from the runtime inside this package: a plain-words status,
 * and a setup page whose files are found next to the bundle (they sit under node_modules here).
 * No browser is opened; the page is fetched over loopback.
 */
async function setupChecks(client) {
  const problems = [];
  const status = await client.callTool({ name: 'setup_status', arguments: { language: 'en' } });
  if (status.isError) problems.push('setup_status returned an error.');
  else if (!/Works now/.test(JSON.stringify(status))) problems.push('setup_status did not answer in plain words.');
  const opened = await client.callTool({ name: 'open_setup', arguments: { keys: ['pubmed'], language: 'en' } });
  const url = opened.structuredContent?.url;
  if (opened.isError || typeof url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) {
    problems.push(`open_setup did not return a loopback address: ${JSON.stringify(opened.structuredContent ?? opened.content).slice(0, 200)}`);
    return problems;
  }
  if (opened.structuredContent?.opened !== false) problems.push('open_setup claims it opened a browser although none can be opened here.');
  const base = url.replace(/\/$/, '');
  for (const [path, pattern] of [['/', /<html/i], ['/app.js', /\S/], ['/styles.css', /\S/]]) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (response.status !== 200 || !pattern.test(await response.text())) problems.push(`The setup page file ${path} was not served (${response.status}); its files are not next to the bundle.`);
  }
  return problems;
}

/** Starts both servers from a package folder and checks their tool lists and one status call. */
export async function startServers(packageDir, { profileDir, workDir }) {
  const problems = [];
  const expected = expectedTools();
  let rows;
  try {
    rows = await patchRows(packageDir, profileDir);
  } catch (error) {
    return [`The servers were not started: ${error instanceof Error ? error.message : error}`];
  }
  const home = join(workDir, 'home');
  const cwd = join(workDir, 'cwd');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  for (const row of rows.filter((r) => r.name === '@deepseek-ai/dsh-mcp-client')) {
    const { serverName } = row.config;
    const isRuntime = serverName === 'ai4s-literature-zotero';
    try {
      const { tools, answer } = await runRow(row, { home, cwd, use: isRuntime ? setupChecks : undefined });
      for (const issue of sameTools(tools, isRuntime ? expected.runtime : expected.fulltext)) problems.push(`${serverName}: ${issue}`);
      problems.push(...(answer ?? []).map((issue) => `${serverName}: ${issue}`));
    } catch (error) {
      problems.push(`${serverName} did not start from its patch row: ${error instanceof Error ? error.message : error}`);
    }
  }
  return problems;
}

function untar(archive, into) {
  mkdirSync(into, { recursive: true });
  const result = spawnSync('tar', ['-xzf', archive, '-C', into], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Could not extract ${archive}: ${result.error?.message ?? result.stderr}`);
}

async function main() {
  const archiveArg = process.argv[2];
  if (!archiveArg) {
    process.stderr.write('usage: node scripts/verify-dsh-plugin.mjs <path-to-tgz>\n');
    process.exit(1);
  }
  const archive = resolve(archiveArg);
  const work = mkdtempSync(join(tmpdir(), 'ai4s-dsh-verify-'));
  const failures = [];
  const report = (name, problems) => {
    const ok = problems.length === 0;
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}\n`);
    if (!ok) {
      failures.push(name);
      process.stdout.write(`${problems.join('\n').replace(/^/gm, '      ')}\n`);
      if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::error title=DeepSeek Harness package check failed::${name}\n`);
    }
  };
  try {
    // The profile folder DeepSeek Harness installs into: <profile>/node_modules/<package name>.
    const profileDir = join(work, 'profile');
    const staged = join(work, 'unpacked');
    untar(archive, staged);
    const packageDir = join(profileDir, 'node_modules', PACKAGE_NAME);
    mkdirSync(dirname(packageDir), { recursive: true });
    renameSync(join(staged, 'package'), packageDir);
    const pluginVersion = JSON.parse(read(join(repoRoot, '.claude-plugin', 'plugin.json'))).version;

    report('the package is well formed, and every path its patch mounts exists inside it', await inspectPackage(packageDir, { pluginVersion, profileDir }));
    report('both servers start from their patch rows and list their exact tools', await startServers(packageDir, { profileDir, workDir: work }));
    const size = statSync(archive).size;
    report('the package is a sensible size', size > 1_000_000 && size < 20_000_000 ? [] : [`${(size / 1e6).toFixed(1)} MB is outside 1 to 20 MB; the bundles are missing or something large was added.`]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} DeepSeek Harness package check(s) failed.\n`);
    process.exit(1);
  }
  process.stdout.write('\nAll DeepSeek Harness package checks passed.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
