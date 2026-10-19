#!/usr/bin/env node
// Verifies the prebuilt single-file bundles the way an end user runs them: copied into a
// folder with no node_modules anywhere above it. Run `npm run bundle` in runtime/ and
// fulltext-runtime/ first.
//
//   node scripts/verify-bundles.mjs
//
// Checks, in order (each prints PASS or FAIL, and the child process's stderr on FAIL):
//   1. runtime bundle over stdio lists exactly the 17 workbench tools
//   2. runtime bundle with --http serves the onboarding page (GET /admin/onboarding)
//   3. fulltext bundle over stdio lists exactly its 6 tools and answers two status calls
//   4. pdfjs parses a PDF from inside a bundle, for both packages, and each shipped
//      bundle contains the pdfjs worker (a probe built with the same options proves the
//      parser works; the content check proves the shipped files carry the worker)
//
// The MCP client comes from runtime/node_modules because it is only the test driver; the
// servers under test never see that folder.
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildBundle } from './bundle.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inActions = process.env.GITHUB_ACTIONS === 'true';

const EXPECTED_RUNTIME_TOOLS = [
  'zotero_ai_summary_context',
  'zotero_apply_ai_summaries',
  'zotero_apply_citation_plan',
  'zotero_apply_fulltext_handoff',
  'zotero_apply_import_plan',
  'zotero_apply_metrics_plan',
  'zotero_apply_semantic_tags',
  'zotero_cleanup_auto_tags',
  'zotero_find_duplicates',
  'zotero_fulltext_context',
  'zotero_get_fulltext',
  'zotero_get_item',
  'zotero_search_items',
  'zotero_semantic_tag_context',
  'zotero_semantic_tag_vocabulary',
  'zotero_sync_literature_project',
  'zotero_whoami',
];
const EXPECTED_FULLTEXT_TOOLS = [
  'fulltext_access_status',
  'fulltext_capabilities',
  'fulltext_fetch_submit',
  'fulltext_job_cancel',
  'fulltext_job_status',
  'fulltext_session_open',
];

const failures = [];
const results = [];

function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}\n`);
  if (!ok) {
    failures.push(name);
    if (detail) process.stdout.write(`${detail.replace(/^/gm, '      ')}\n`);
    if (inActions) process.stdout.write(`::error title=Bundle check failed::${name}\n`);
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

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s: ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function assertSameList(actual, expected, what) {
  const a = [...actual].sort();
  if (JSON.stringify(a) !== JSON.stringify([...expected].sort())) {
    const missing = expected.filter((name) => !a.includes(name));
    const extra = a.filter((name) => !expected.includes(name));
    throw new Error(`${what}: expected ${expected.length} tools, got ${a.length}.\n  missing: ${missing.join(', ') || '(none)'}\n  unexpected: ${extra.join(', ') || '(none)'}`);
  }
}

// --- A folder shaped like the release archive, with no node_modules above it. ---

const work = mkdtempSync(join(tmpdir(), 'ai4s-bundle-verify-'));
const pluginDir = join(work, 'plugin');
const homeDir = join(work, 'home');
mkdirSync(homeDir, { recursive: true });

function assertNoNodeModulesAbove(dir) {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, 'node_modules'))) {
      throw new Error(`${current} has a node_modules folder, so this run would not prove the bundles are self-contained.`);
    }
    if (current === parse(current).root) return;
  }
}

function stage() {
  for (const name of ['runtime', 'fulltext-runtime']) {
    const source = join(repoRoot, name, 'bundle');
    if (!existsSync(join(source, 'index.mjs'))) {
      throw new Error(`Missing ${name}/bundle/index.mjs. Run "npm run bundle" in ${name}/ first.`);
    }
    cpSync(source, join(pluginDir, name, 'bundle'), { recursive: true });
  }
  cpSync(join(repoRoot, 'bundle-manifest.json'), join(pluginDir, 'bundle-manifest.json'));
  assertNoNodeModulesAbove(pluginDir);
}

// Developer configuration and keys must not leak into the run.
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(ZOTERO_|ZOTEUS_|LITERATURE_|PUBMED_|EASYSCHOLAR_|NODE_PATH$|NODE_OPTIONS$)/.test(key)) delete env[key];
  }
  return {
    ...env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
    APPDATA: join(homeDir, 'AppData', 'Roaming'),
    XDG_CONFIG_HOME: join(homeDir, '.config'),
    ...extra,
  };
}

// Collects a child's stderr so a failure can show why it died.
function collect(stream, limit = 8000) {
  const chunks = [];
  let size = 0;
  stream?.on('data', (chunk) => {
    chunks.push(chunk);
    size += chunk.length;
    while (size > limit && chunks.length > 1) size -= chunks.shift().length;
  });
  return () => Buffer.concat(chunks).toString('utf8').trim();
}

async function loadClient() {
  const sdk = join(repoRoot, 'runtime', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');
  const { Client } = await import(pathToFileURL(join(sdk, 'index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'stdio.js')).href);
  return { Client, StdioClientTransport };
}

async function withStdioClient({ Client, StdioClientTransport }, name, entry, env, use) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: pluginDir,
    env,
    stderr: 'pipe',
  });
  const stderrText = collect(transport.stderr);
  const client = new Client({ name: 'ai4s-bundle-verify', version: '0.1.0' });
  try {
    await withTimeout(client.connect(transport), 60_000, `${name} to answer the MCP handshake`);
    return await withTimeout(use(client), 60_000, `${name} to answer`);
  } catch (error) {
    const log = stderrText();
    throw new Error(`${error instanceof Error ? error.message : error}${log ? `\nserver stderr:\n${log}` : ''}`);
  } finally {
    await client.close().catch(() => {});
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(base, child, stderrText) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode} before it was ready.\nserver stderr:\n${stderrText()}`);
    try {
      const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not answer /healthz within 30s.\nserver stderr:\n${stderrText()}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
}

async function verifyHttp() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(pluginDir, 'runtime', 'bundle', 'index.mjs'), '--http', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: pluginDir,
    env: cleanEnv({ LITERATURE_ZOTERO_MCP_TOOL_PROFILE: 'workbench', ZOTEUS_LOCAL: 'off', ZOTEUS_EMBEDDINGS: 'off' }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const stderrText = collect(child.stderr);
  try {
    await waitForHealth(base, child, stderrText);
    // The bare prefix redirects to the trailing-slash page; fetch follows it.
    const page = await fetch(`${base}/admin/onboarding`, { signal: AbortSignal.timeout(10_000) });
    const body = await page.text();
    if (page.status !== 200) throw new Error(`GET /admin/onboarding returned ${page.status}.\nserver stderr:\n${stderrText()}`);
    if (!/<html/i.test(body)) throw new Error('GET /admin/onboarding returned 200 but the body is not the setup page.');
    for (const asset of ['app.js', 'styles.css']) {
      const response = await fetch(`${base}/admin/onboarding/${asset}`, { signal: AbortSignal.timeout(10_000) });
      if (response.status !== 200) throw new Error(`GET /admin/onboarding/${asset} returned ${response.status}; the page assets are not next to the bundle.`);
    }
  } finally {
    await stop(child);
  }
}

// Builds a tiny entry point with the shipped bundle options, then runs it where there is
// no node_modules. This is how pdfjs breaks in a bundle: it loads its worker by path.
async function verifyPdfProbe(packageName, expectText) {
  const outfile = join(work, 'probes', `${packageName}.mjs`);
  await buildBundle({
    packageDir: join(repoRoot, packageName),
    entry: join(repoRoot, packageName, 'tests', 'bundle-probe.ts'),
    outfile,
  });
  const child = spawn(process.execPath, [outfile], { cwd: pluginDir, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const stdoutText = collect(child.stdout);
  const stderrText = collect(child.stderr);
  const code = await withTimeout(new Promise((r) => child.once('exit', r)), 60_000, `${packageName} PDF probe`);
  const line = stdoutText().split(/\r?\n/).find((l) => l.startsWith('PROBE_RESULT '));
  if (code !== 0 || !line) throw new Error(`PDF probe exited with code ${code}.\nstdout: ${stdoutText()}\nstderr: ${stderrText()}`);
  const result = JSON.parse(line.slice('PROBE_RESULT '.length));
  if (result.pageCount !== 1 || !expectText(result)) {
    throw new Error(`The PDF was not parsed from the bundle: ${JSON.stringify(result)}\nstderr: ${stderrText()}`);
  }
}

try {
  stage();
  const driver = await loadClient();
  const runtimeEntry = join(pluginDir, 'runtime', 'bundle', 'index.mjs');
  const fulltextEntry = join(pluginDir, 'fulltext-runtime', 'bundle', 'index.mjs');

  await check('runtime bundle starts over stdio and lists its 17 workbench tools', () =>
    withStdioClient(driver, 'runtime bundle', runtimeEntry,
      cleanEnv({ LITERATURE_ZOTERO_MCP_TOOL_PROFILE: 'workbench', ZOTEUS_LOCAL: 'off', ZOTEUS_EMBEDDINGS: 'off' }),
      async (client) => {
        const { tools } = await client.listTools();
        assertSameList(tools.map((tool) => tool.name), EXPECTED_RUNTIME_TOOLS, 'runtime bundle');
      }));

  await check('runtime bundle with --http serves GET /admin/onboarding', verifyHttp);

  await check('fulltext bundle starts over stdio and lists its 6 tools', () => {
    const privateRoot = join(work, 'fulltext');
    return withStdioClient(driver, 'fulltext bundle', fulltextEntry,
      cleanEnv({
        LITERATURE_FULLTEXT_DATA_DIR: join(privateRoot, 'data'),
        LITERATURE_FULLTEXT_EXCHANGE_ROOT: join(privateRoot, 'exchange'),
      }),
      async (client) => {
        const { tools } = await client.listTools();
        assertSameList(tools.map((tool) => tool.name), EXPECTED_FULLTEXT_TOOLS, 'fulltext bundle');
        for (const name of ['fulltext_capabilities', 'fulltext_access_status']) {
          const result = await client.callTool({ name, arguments: {} });
          if (result.isError) throw new Error(`${name} returned an error.`);
        }
      });
  });

  await check('shipped bundles contain the pdfjs worker', () => {
    for (const entry of [runtimeEntry, fulltextEntry]) {
      const text = readFileSync(entry, 'utf8');
      if (!text.includes('WorkerMessageHandler') || !text.includes('pdfjsWorker')) {
        throw new Error(`${entry} does not embed the pdfjs worker, so PDF parsing would fail.`);
      }
    }
  });
  await check('fulltext bundle options parse a PDF with pdfjs', () =>
    verifyPdfProbe('fulltext-runtime', (r) => r.titleMatch === true));
  await check('runtime bundle options extract PDF pages with pdfjs', () =>
    verifyPdfProbe('runtime', (r) => typeof r.text === 'string' && r.text.includes('Hello')));
} catch (error) {
  report('set-up', false, error instanceof Error ? error.message : String(error));
} finally {
  rmSync(work, { recursive: true, force: true });
}

// On GitHub Actions, put the result on the run's summary page so a Windows failure can be
// read without opening the log.
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [`### Bundle checks (${process.platform}, Node ${process.versions.node})`, '', '| Result | Check |', '| --- | --- |'];
  for (const { name, ok } of results) lines.push(`| ${ok ? 'PASS' : '**FAIL**'} | ${name} |`);
  for (const { name, ok, detail } of results) {
    if (!ok && detail) lines.push('', `<details open><summary>${name}</summary>`, '', '```text', detail, '```', '', '</details>');
  }
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  } catch {
    // The summary is a convenience; the log above has the same information.
  }
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} bundle check(s) failed.\n`);
  process.exit(1);
}
process.stdout.write('\nAll bundle checks passed.\n');
