import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalPlanHash,
  compareCodePoints,
  type ImportPlan,
  validateImportPlan,
} from '../../src/features/import-plan/contract.js';

// Shared with skills/literature-manager/tests/test_zotero_literature_manager.py.
// Its plan_hash was written by the Python plan-import helper.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const managerDir = join(repoRoot, 'skills/literature-manager/scripts');
const fixturePath = join(
  repoRoot,
  'skills/literature-manager/tests/fixtures/import_plan_mixed_case_tags.json',
);

function fixture(): ImportPlan {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as ImportPlan;
}

function findPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && probe.stdout.trim() === '3') return candidate;
  }
  return null;
}

function pythonHash(python: string, plan: unknown): string {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(managerDir)})`,
    'import zotero_literature_manager as zlm',
    'plan = json.loads(sys.stdin.read())',
    'print(zlm.canonical_plan_hash(plan))',
  ].join('\n');
  const run = spawnSync(python, ['-c', script], {
    input: JSON.stringify(plan),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  if (run.status !== 0) throw new Error(`python hash failed: ${run.stderr}`);
  return run.stdout.trim();
}

describe('import plan hash parity (TypeScript runtime vs Python plan-import)', () => {
  it('orders strings by code point, like Python sorted()', () => {
    const tags = [
      'project:x',
      'import-run:x',
      'JCR:Q1',
      'CAS:1区',
      'AI4S:Priority:1',
      'note:😀',
      'note:～',
    ];
    expect([...tags].sort(compareCodePoints)).toEqual([
      'AI4S:Priority:1',
      'CAS:1区',
      'JCR:Q1',
      'import-run:x',
      'note:～',
      'note:😀',
      'project:x',
    ]);
    expect(compareCodePoints('a', 'a')).toBe(0);
    expect(compareCodePoints('a', 'ab')).toBe(-1);
    expect(compareCodePoints('ab', 'a')).toBe(1);
  });

  it('accepts the Python-hashed fixture with mixed-case metrics tags', () => {
    const plan = fixture();
    const stored = plan.plan_hash;
    expect(canonicalPlanHash(structuredClone(plan))).toBe(stored);
    expect(validateImportPlan(structuredClone(plan)).plan_hash).toBe(stored);
  });

  it('does not echo the expected hash when the plan was edited', () => {
    const plan = fixture();
    const computed = canonicalPlanHash(structuredClone(plan));
    plan.actions[0].item!.title = 'Edited after generation';
    const edited = canonicalPlanHash(structuredClone(plan));
    let message = '';
    try {
      validateImportPlan(plan);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/Plan hash mismatch/);
    expect(message).toMatch(/Regenerate the plan/);
    expect(message).not.toContain(computed.slice('sha256:'.length));
    expect(message).not.toContain(edited.slice('sha256:'.length));
  });

  const python = findPython();
  it.skipIf(!python)(
    'matches the live Python helper on the fixture and on reordered variants',
    () => {
      const plan = fixture();
      expect(pythonHash(python!, plan)).toBe(plan.plan_hash);

      const variant = structuredClone(plan) as any;
      variant.actions.reverse();
      for (const action of variant.actions) action.item?.tags?.reverse();
      variant.target.tags.reverse();
      variant.actions[0].item.tags.push({ tag: 'Zeta:upper' }, { tag: 'alpha:lower' });
      expect(pythonHash(python!, variant)).toBe(canonicalPlanHash(structuredClone(variant)));
    },
  );
});
