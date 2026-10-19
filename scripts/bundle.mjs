#!/usr/bin/env node
// Bundles one MCP runtime into a single ESM file so end users need no
// `npm install` and no TypeScript build.
//
//   node scripts/bundle.mjs <package-dir>      e.g. runtime or fulltext-runtime
//
// Output, inside <package-dir>/bundle/:
//   index.mjs                 the whole server, dependencies included
//   index.mjs.LEGAL.txt       third-party license comments esbuild extracted (when any)
//   public/onboarding/        the setup page, when the package has src/public/onboarding
//   LICENSE, THIRD_PARTY_NOTICES.md, licenses/   copied from the package when present
//
// esbuild is resolved from the package's own node_modules, so run `npm ci` there first.
import { builtinModules, createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Optional dependencies loaded with a guarded dynamic import. They are not shipped in
// a bundle; the code that imports them already degrades when they are absent.
const OPTIONAL_EXTERNALS = ['@huggingface/transformers'];

// A bundle has no `require`, but some CommonJS dependencies still call it.
const REQUIRE_BANNER =
  "import {createRequire as __ai4sCreateRequire} from 'node:module'; const require = __ai4sCreateRequire(import.meta.url);";

function fail(message) {
  process.stderr.write(`bundle: ${message}\n`);
  process.exit(1);
}

const packageArg = process.argv[2];
if (!packageArg) fail('usage: node scripts/bundle.mjs <package-dir>');
const packageDir = resolve(packageArg);
const entry = join(packageDir, 'src', 'index.ts');
if (!existsSync(entry)) fail(`${entry} does not exist.`);

let esbuild;
try {
  esbuild = createRequire(join(packageDir, 'package.json'))('esbuild');
} catch {
  fail(`esbuild is not installed for ${packageDir}. Run "npm ci" there first.`);
}

const outDir = join(packageDir, 'bundle');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let result;
try {
  result = await esbuild.build({
    entryPoints: [entry],
    outfile: join(outDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: REQUIRE_BANNER },
    external: OPTIONAL_EXTERNALS,
    legalComments: 'external',
    metafile: true,
    logLevel: 'warning',
  });
} catch {
  // esbuild has already printed each error with its file and line.
  fail(`esbuild failed for ${packageDir}.`);
}

// Anything still external that is neither a Node built-in nor a listed optional
// dependency would fail at start-up on a machine with no node_modules. Fail here instead.
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const allowed = (path) =>
  builtins.has(path) || path.startsWith('node:') || OPTIONAL_EXTERNALS.some((name) => path === name || path.startsWith(`${name}/`));
const stray = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const imported of output.imports) {
    if (imported.external && !allowed(imported.path)) stray.add(imported.path);
  }
}
if (stray.size > 0) {
  fail(`the bundle still imports packages it does not contain: ${[...stray].join(', ')}`);
}

const publicSource = join(packageDir, 'src', 'public', 'onboarding');
if (existsSync(publicSource)) {
  cpSync(publicSource, join(outDir, 'public', 'onboarding'), { recursive: true });
}
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses']) {
  const source = join(packageDir, name);
  if (existsSync(source)) cpSync(source, join(outDir, name), { recursive: true });
}

const bytes = statSync(join(outDir, 'index.mjs')).size;
process.stdout.write(`bundle: ${join(outDir, 'index.mjs')} (${(bytes / 1024 / 1024).toFixed(1)} MB)\n`);
