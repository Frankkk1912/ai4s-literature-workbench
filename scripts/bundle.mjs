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
import { pathToFileURL } from 'node:url';

// Optional dependencies loaded with a guarded dynamic import. They are not shipped in
// a bundle; the code that imports them already degrades when they are absent.
const OPTIONAL_EXTERNALS = ['@huggingface/transformers'];

// A bundle has no `require`, but some CommonJS dependencies still call it.
const REQUIRE_BANNER =
  "import {createRequire as __ai4sCreateRequire} from 'node:module'; const require = __ai4sCreateRequire(import.meta.url);";

export class BundleError extends Error {}

/**
 * Bundles `entry` (default: <packageDir>/src/index.ts) into one ESM file with the same
 * options the shipped bundles use. esbuild is resolved from the package's node_modules.
 * Returns the output path.
 */
export async function buildBundle({ packageDir, entry = join(packageDir, 'src', 'index.ts'), outfile }) {
  if (!existsSync(entry)) throw new BundleError(`${entry} does not exist.`);

  let esbuild;
  try {
    esbuild = createRequire(join(packageDir, 'package.json'))('esbuild');
  } catch {
    throw new BundleError(`esbuild is not installed for ${packageDir}. Run "npm ci" there first.`);
  }

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [entry],
      outfile,
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
    throw new BundleError(`esbuild failed for ${entry}.`);
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
    throw new BundleError(`the bundle still imports packages it does not contain: ${[...stray].join(', ')}`);
  }
  return outfile;
}

/** Builds <packageDir>/bundle/ : index.mjs plus the files that must ship beside it. */
export async function bundlePackage(packageDir) {
  if (!existsSync(join(packageDir, 'src', 'index.ts'))) {
    throw new BundleError(`${join(packageDir, 'src', 'index.ts')} does not exist.`);
  }
  const outDir = join(packageDir, 'bundle');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const outfile = await buildBundle({ packageDir, outfile: join(outDir, 'index.mjs') });

  const publicSource = join(packageDir, 'src', 'public', 'onboarding');
  if (existsSync(publicSource)) {
    cpSync(publicSource, join(outDir, 'public', 'onboarding'), { recursive: true });
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses']) {
    const source = join(packageDir, name);
    if (existsSync(source)) cpSync(source, join(outDir, name), { recursive: true });
  }
  return outfile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const packageArg = process.argv[2];
  if (!packageArg) {
    process.stderr.write('bundle: usage: node scripts/bundle.mjs <package-dir>\n');
    process.exit(1);
  }
  try {
    const outfile = await bundlePackage(resolve(packageArg));
    process.stdout.write(`bundle: ${outfile} (${(statSync(outfile).size / 1024 / 1024).toFixed(1)} MB)\n`);
  } catch (error) {
    if (!(error instanceof BundleError)) throw error;
    process.stderr.write(`bundle: ${error.message}\n`);
    process.exit(1);
  }
}
