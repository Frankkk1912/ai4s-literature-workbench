import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the standalone fulltext manifest uses relocatable Node startup and automatic defaults', () => {
  const manifest = JSON.parse(read('release/mcpb-fulltext/manifest.json'));
  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.name, 'ai4s-literature-fulltext');
  assert.equal(manifest.version, '__VERSION__');
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'server/index.mjs');
  assert.equal(manifest.server.mcp_config.command, 'node');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.mjs']);
  assert.equal(manifest.compatibility.runtimes.node, '>=22.13.0');
  assert.deepEqual(manifest.compatibility.platforms, ['darwin', 'win32']);
  assert.equal(manifest.user_config, undefined, 'keep storage paths and limits at server defaults');
  assert.equal(manifest.server.mcp_config.env, undefined, 'do not invent provider env settings');
  assert.doesNotMatch(JSON.stringify(manifest), /openalex|unpaywall|mailto/i);
  assert.match(manifest.description, /OA-first full-text fetch and PDF verification/);
  assert.match(manifest.description, /no Zotero credentials or institutional login/);
});

test('packaging copies the entire fulltext bundle and validates and packs with the pinned CLI', () => {
  const source = read('scripts/package-release.mjs');
  assert.ok(source.includes("const MCPB_PACKAGE = '@anthropic-ai/mcpb@2.1.2'"));
  assert.ok(source.includes("join(repoRoot, 'release', 'mcpb-fulltext', 'manifest.json')"));
  assert.match(source, /fulltextManifest = .*\.replaceAll\('__VERSION__', version\)/);
  assert.ok(source.includes("copyTree(join(repoRoot, 'fulltext-runtime', 'bundle'), join(fulltextMcpbRoot, 'server'))"));
  assert.ok(source.includes("cpSync(join(repoRoot, 'runtime', 'dxt', 'icon.png'), join(fulltextMcpbRoot, 'icon.png'))"));
  assert.ok(source.includes('`ai4s-literature-fulltext-${version}.mcpb`'));
  assert.ok(source.includes("run('npx', ['--yes', MCPB_PACKAGE, 'validate', fulltextMcpbRoot])"));
  assert.ok(source.includes("run('npx', ['--yes', MCPB_PACKAGE, 'pack', fulltextMcpbRoot, fulltextMcpbPath])"));
  assert.ok(source.includes('assets.push(fulltextMcpbPath)'), 'fulltext must be included in SHA256SUMS.txt');
});

test('release verification checks both named archives and the same exact six fulltext tools as bundle verification', () => {
  const source = read('scripts/verify-release.mjs');
  assert.ok(source.includes('`ai4s-literature-zotero-${version}.mcpb`'));
  assert.ok(source.includes('`ai4s-literature-fulltext-${version}.mcpb`'));
  assert.ok(source.includes('for (const name of [zoteroMcpbName, fulltextMcpbName])'));
  assert.ok(source.includes('extract(join(releaseDir, zoteroMcpbName), mcpbDir)'));
  assert.ok(source.includes('extract(join(releaseDir, fulltextMcpbName), mcpbDir)'));
  assert.ok(!source.includes('find(/\\.mcpb$/)'), 'a generic .mcpb lookup is ambiguous');
  const toolNames = (text) => text.match(/const EXPECTED_FULLTEXT_TOOLS = \[([\s\S]*?)\]/)[1]
    .match(/'fulltext_[a-z_]+'/g).sort();
  assert.equal(toolNames(source).length, 6);
  assert.deepEqual(toolNames(source), toolNames(read('scripts/verify-bundles.mjs')));
  const fulltextCheck = source.split("await check('fulltext .mcpb")[1];
  assert.match(fulltextCheck, /cwd: scratch/);
  assert.match(fulltextCheck, /args: args\.map\(substitute\)/);
  assert.match(fulltextCheck, /replaceAll\('\$\{__dirname\}', mcpbDir\)/);
  assert.match(fulltextCheck, /client\.listTools\(\)/);
  assert.match(fulltextCheck, /client\.callTool\(\{ name: 'fulltext_capabilities'/);
  assert.doesNotMatch(fulltextCheck, /Expected the manifest to have an optional setting with no default/);
});
