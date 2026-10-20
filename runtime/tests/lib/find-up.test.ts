import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findUp } from '../../src/lib/find-up.js';

const dirs: string[] = [];
function layout(): string {
  const root = mkdtempSync(join(tmpdir(), 'find-up-'));
  dirs.push(root);
  return root;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('findUp', () => {
  it('finds the marker in the start directory itself', () => {
    const root = layout();
    writeFileSync(join(root, 'marker.json'), '{}');
    expect(findUp(root, 'marker.json')).toBe(root);
  });

  it('finds the marker in a parent', () => {
    const root = layout();
    const deep = join(root, 'a', 'b');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(root, 'marker.json'), '{}');
    expect(findUp(deep, 'marker.json')).toBe(root);
  });

  it('stops after maxLevels parents', () => {
    const root = layout();
    const deep = join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(root, 'marker.json'), '{}');
    expect(findUp(deep, 'marker.json', 2)).toBeUndefined();
    expect(findUp(deep, 'marker.json', 3)).toBe(root);
  });

  it('returns undefined when the marker is nowhere above', () => {
    const root = layout();
    expect(findUp(root, 'no-such-marker-ai4s.json')).toBeUndefined();
  });
});
