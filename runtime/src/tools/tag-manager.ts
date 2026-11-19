import { z } from 'zod';
import type { LibraryRef } from '../api/web-client.js';
import type { ToolContext, ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';
import { applyTagPlan, listUnusedTags, planTagChanges, scanTagDuplicates } from '../features/tags/manager.js';

const operation = z.object({
  op: z.enum(['merge', 'rename', 'delete_unused']),
  loser: z.string().min(1).max(200).optional().describe('Merge: exact tag to fold away.'),
  winner: z.string().min(1).max(200).optional().describe('Merge: exact tag that remains.'),
  from: z.string().min(1).max(200).optional().describe('Rename: exact current tag.'),
  to: z.string().min(1).max(200).optional().describe('Rename: exact replacement tag.'),
  tag: z.string().min(1).max(200).optional().describe('delete_unused: one exact unused tag.'),
  tags: z.array(z.string().min(1).max(200)).max(100).optional().describe('delete_unused: exact unused tags.'),
});

function libraryOf(ctx: ToolContext, args: { library_type?: 'user' | 'group'; library_id?: number }): LibraryRef {
  if (args.library_id) return { type: args.library_type ?? 'group', id: args.library_id };
  return ctx.router.defaultLibrary();
}

const tagManager: ToolDefinition = {
  name: 'zotero_tag_manager',
  title: 'Find, merge, and retire duplicate Zotero tags',
  description:
    'Unified tag hygiene for one Zotero library and its semantic vocabulary. scan finds duplicate clusters (case/NFKC/dash/whitespace, punctuation, singular/plural, and vocabulary-alias abbreviations) with usage counts; set include_near for token-overlap suggestions you must judge yourself. unused lists library tags with zero items and vocabulary entries no live tag uses. plan writes a hashed plan and does not change Zotero or the vocabulary. apply mode dry_run rechecks item versions and the vocabulary revision; mode apply requires confirm_plan_hash, patches only the named tags, folds a merged vocabulary loser into the winner\'s aliases, and writes a receipt. Untargeted user tags stay on each item. AI4S:Priority:1-3, AI4S:ArticleType:*, JCR:*, and CAS:* are refused unless the operation names them and allow_protected is true. Do not use this for item-level add/remove (zotero_manage_tags), plain listing (zotero_list_tags), tier coverage (zotero_tag_audit), type-1 automatic cleanup (zotero_cleanup_auto_tags), or vocabulary import/export (zotero_semantic_tag_vocabulary).',
  inputSchema: {
    action: z.enum(['scan', 'unused', 'plan', 'apply']),
    include_near: z.boolean().optional().describe('scan: also return token-overlap suggestions. Default false.'),
    include_protected: z.boolean().optional().describe('unused: include zero-item Priority, Article Type, JCR, and CAS tags.'),
    limit: z.number().int().min(1).max(200).optional().describe('scan cluster limit (default 50) or unused list limit (default 100).'),
    operations: z.array(operation).max(50).optional().describe('plan: merge, rename, and delete_unused operations. Use exact tag strings from scan or unused.'),
    expected_revision: z.number().int().min(0).optional().describe('plan: vocabulary revision from scan or unused. Required.'),
    allow_protected: z.boolean().optional().describe('plan: required when an operation names a Priority, Article Type, JCR, or CAS tag.'),
    max_items: z.number().int().min(1).max(1000).optional().describe('plan: maximum items a merge or rename may touch (default 200).'),
    plan_path: z.string().min(1).optional().describe('apply: path returned by plan.'),
    mode: z.enum(['dry_run', 'apply']).optional().describe('apply: dry_run writes nothing; apply requires confirm_plan_hash.'),
    confirm_plan_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional().describe('apply: exact plan_hash from plan.'),
    library_type: z.enum(['user', 'group']).optional(),
    library_id: z.number().int().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  handler: async (args, ctx) => {
    const library = libraryOf(ctx, args);
    if (args.action === 'scan') {
      const result = await scanTagDuplicates(ctx, library, { includeNear: args.include_near, limit: args.limit });
      const clusters = result.clusters as unknown[];
      const near = (result.near_matches as unknown[] | undefined)?.length ?? 0;
      return ok(result, `Tag scan: ${clusters.length} duplicate cluster(s)${args.include_near ? `, ${near} near match(es)` : ''} at vocabulary revision ${result.vocabulary_revision}.`);
    }
    if (args.action === 'unused') {
      const result = await listUnusedTags(ctx, library, { includeProtected: args.include_protected, limit: args.limit });
      const libraryTags = result.library_tags as unknown[];
      const entries = result.vocabulary_entries as unknown[];
      return ok(result, `Unused tags: ${libraryTags.length} library tag(s) with zero items, ${entries.length} unused vocabulary entr${entries.length === 1 ? 'y' : 'ies'}.`);
    }
    if (args.action === 'plan') {
      if (!args.operations?.length) throw new Error('operations are required for plan');
      if (args.expected_revision === undefined) throw new Error('expected_revision is required for plan');
      const result = await planTagChanges(ctx, library, {
        operations: args.operations,
        expectedRevision: args.expected_revision,
        allowProtected: args.allow_protected,
        maxItems: args.max_items,
      });
      return ok(result, `Tag plan ${result.plan_hash}: ${result.item_count} item(s), ${result.deletion_count} unused-tag deletion(s). Review it, dry-run, then apply with confirm_plan_hash.`);
    }
    if (!args.plan_path) throw new Error('plan_path is required for apply');
    if (!args.mode) throw new Error('mode is required for apply');
    const result = await applyTagPlan(ctx, library, {
      planPath: args.plan_path, mode: args.mode, confirmPlanHash: args.confirm_plan_hash,
    });
    if (args.mode === 'dry_run') {
      return ok(result, `Tag plan dry run: ${result.item_count} item(s) and vocabulary revision ${result.vocabulary_revision} match the plan. No writes were attempted.`);
    }
    const summary = result.summary as Record<string, number>;
    return ok(result, `Tag apply ${result.status}: updated=${summary.updated ?? 0}, unchanged=${summary.unchanged ?? 0}, failed=${summary.failed ?? 0}.`);
  },
};

export default tagManager;
