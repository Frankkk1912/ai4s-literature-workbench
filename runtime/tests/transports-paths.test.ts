import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePublicDirectory, resolveRepositoryRoot } from '../src/transports/admin.js';

const dirs: string[] = [];
function layout(): string {
  const root = mkdtempSync(join(tmpdir(), 'admin-paths-'));
  dirs.push(root);
  return root;
}
function urlOf(file: string): string {
  return pathToFileURL(file).href;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolvePublicDirectory', () => {
  it('prefers the page next to a single-file bundle', () => {
    const root = layout();
    mkdirSync(join(root, 'bundle', 'public', 'onboarding'), { recursive: true });
    expect(resolvePublicDirectory(urlOf(join(root, 'bundle', 'index.mjs')))).toBe(
      join(root, 'bundle', 'public', 'onboarding') + (process.platform === 'win32' ? '\\' : '/'),
    );
  });

  it('finds the page beside compiled dist/transports', () => {
    const root = layout();
    mkdirSync(join(root, 'dist', 'public', 'onboarding'), { recursive: true });
    expect(resolvePublicDirectory(urlOf(join(root, 'dist', 'transports', 'admin.js')))).toContain(
      join('dist', 'public', 'onboarding'),
    );
  });

  it('falls back to the source copy', () => {
    const root = layout();
    expect(resolvePublicDirectory(urlOf(join(root, 'src', 'transports', 'admin.ts')))).toContain(
      join('src', 'public', 'onboarding'),
    );
  });
});

describe('resolveRepositoryRoot', () => {
  it('finds the plugin root from a bundle at runtime/bundle', () => {
    const root = layout();
    mkdirSync(join(root, 'runtime', 'bundle'), { recursive: true });
    writeFileSync(join(root, 'bundle-manifest.json'), '{}');
    expect(resolveRepositoryRoot(urlOf(join(root, 'runtime', 'bundle', 'index.mjs')))).toBe(root);
  });

  it('finds the plugin root from runtime/dist/transports', () => {
    const root = layout();
    mkdirSync(join(root, 'runtime', 'dist', 'transports'), { recursive: true });
    writeFileSync(join(root, 'bundle-manifest.json'), '{}');
    expect(resolveRepositoryRoot(urlOf(join(root, 'runtime', 'dist', 'transports', 'admin.js')))).toBe(root);
  });
});
