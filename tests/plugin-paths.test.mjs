// Plugin MCP paths must not depend on the directory in which a session starts.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const readJson = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const projectMcp = readJson('.mcp.json').mcpServers;

for (const [host, variable] of [
  ['claude', '${CLAUDE_PLUGIN_ROOT}'],
  ['codebuddy', '${CODEBUDDY_PLUGIN_ROOT}'],
]) {
  const file = `.${host}-plugin/plugin.json`;
  const plugin = readJson(file);

  test(`${host} plugin MCP config has no ./ relative args or cwd`, () => {
    assert.equal(plugin.version, readJson('.codex-plugin/plugin.json').version);
    assert.deepEqual(Object.keys(plugin.mcpServers).sort(), Object.keys(projectMcp).sort());
    for (const [name, server] of Object.entries(plugin.mcpServers)) {
      assert.equal(server.command, 'node');
      assert.equal(server.cwd, variable);
      assert.ok(!server.cwd.startsWith('./') && server.cwd !== '.');
      assert.ok(server.args.every((arg) => !arg.startsWith('./')), `${file}: ${name} has relative args`);
      assert.deepEqual(server.args, projectMcp[name].args.map((arg) => arg.replace(/^\./, variable)));
      assert.deepEqual(server.env, projectMcp[name].env);
    }
  });

  test(`${host} source entries start from a scratch session, including a plugin path with spaces`, () => {
    const work = mkdtempSync(join(tmpdir(), 'ai4s plugin paths-'));
    const root = join(work, 'plugin with spaces');
    const scratch = join(work, 'scratch-session');
    mkdirSync(scratch, { recursive: true });
    const expand = (text) => text.replaceAll(variable, root);
    try {
      for (const server of Object.values(plugin.mcpServers)) {
        const entry = expand(server.args[0]);
        const cwd = expand(server.cwd);
        assert.ok(isAbsolute(entry) && isAbsolute(cwd));
        mkdirSync(dirname(entry), { recursive: true });
        // A stand-in at the declared source entry proves Node and cwd resolution,
        // without building either server or needing the user's configuration.
        writeFileSync(entry, 'console.log(JSON.stringify({ cwd: process.cwd(), entry: process.argv[1] }));');
        const child = spawnSync(process.execPath, ['-e', `
          const { spawnSync } = require('node:child_process');
          const child = spawnSync(process.execPath, ${JSON.stringify(server.args.map(expand))}, {
            cwd: ${JSON.stringify(cwd)}, encoding: 'utf8'
          });
          process.stdout.write(child.stdout || '');
          process.stderr.write(child.stderr || '');
          process.exit(child.status ?? 1);
        `], { cwd: scratch, encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr);
        const actual = JSON.parse(child.stdout);
        // macOS exposes /var as a symlink to /private/var; compare canonical paths.
        assert.equal(realpathSync(actual.cwd), realpathSync(root));
        assert.equal(realpathSync(actual.entry), realpathSync(entry));
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
}

test('the shared project MCP config stays relative for non-plugin hosts', () => {
  assert.deepEqual(projectMcp['ai4s-literature-zotero'].args, ['./runtime/dist/index.js']);
  assert.deepEqual(projectMcp['ai4s-literature-fulltext'].args, ['./fulltext-runtime/dist/index.js']);
  for (const server of Object.values(projectMcp)) assert.equal(server.cwd, '.');
});
