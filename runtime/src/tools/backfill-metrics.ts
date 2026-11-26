import { z } from 'zod';
import type { ToolDefinition } from '../registry/registry.js';
import { ok, requireCloudLibrary } from '../registry/registry.js';
import { backfillMetrics } from '../features/metrics-backfill.js';

const backfillMetricsTool: ToolDefinition = {
  name: 'zotero_backfill_metrics',
  title: 'Backfill IF/JCR/CAS metrics for an existing collection or selected items',
  description:
    'One-step IF/5-Year IF/JCR/CAS backfill for items that already exist in Zotero. Pass a collection_key or selected item_keys. Items and their version numbers are fetched from the cloud Web API (api.zotero.org); desktop local-API versions are never used in the plan. Journal ranks are queried on easyscholar.cc by journal name using the key already configured on the local setup page, with the shared disk cache and rate-limited requests; no key is accepted or returned here. A hashed zotero-metrics plan is built and executed by the same reviewed path as zotero_apply_metrics_plan. Omitted mode defaults to dry_run, which never writes to Zotero. apply is explicit and requires receipt_path plus confirm_plan_hash matching the freshly rebuilt plan hash — any version or data change makes the hash differ and the apply is refused; re-run dry_run and confirm the new hash. Preprints are skipped; a missing EasyScholar key, per-journal network failures, and journals with no rank data are counted per item in the result and never abort the batch.',
  inputSchema: {
    collection_key: z.string().regex(/^[A-Z0-9]{8}$/).optional().describe('Existing collection key (use zotero_list_collections to find it).'),
    item_keys: z.array(z.string().regex(/^[A-Z0-9]{8}$/)).min(1).optional().describe('Selected item keys instead of a whole collection.'),
    mode: z.enum(['dry_run', 'apply']).optional().describe('Defaults to dry_run. apply additionally requires confirm_plan_hash and receipt_path.'),
    metrics_year: z.number().int().optional().describe('Display metric year written into Extra; defaults to last year (the EasyScholar payload itself is always latest).'),
    source_label: z.string().optional().describe('Optional provenance label; defaults to easyscholar-latest.'),
    plan_path: z.string().optional().describe('Optional path where the built plan JSON is saved for review (dry_run).'),
    confirm_plan_hash: z.string().optional().describe('Required for apply: the exact plan_hash reported by the dry run of this same collection/items.'),
    receipt_path: z.string().optional().describe('Required for apply: where the execution receipt is written.'),
    easyscholar_cache_path: z.string().optional().describe('Optional EasyScholar cache file override (default: the shared workbench cache).'),
    limit: z.number().int().positive().optional().describe('Optional cap on processed items; a capped run reports capped: true.'),
    library_type: z.enum(['user', 'group']).optional(),
    library_id: z.number().int().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async (args, ctx) => {
    if (Boolean(args.collection_key) === Boolean(args.item_keys?.length)) {
      throw new Error('Pass exactly one of collection_key or item_keys.');
    }
    const lib = requireCloudLibrary(ctx, args);
    const result = await backfillMetrics(ctx, lib, {
      collection_key: args.collection_key,
      item_keys: args.item_keys,
      mode: args.mode ?? 'dry_run',
      metrics_year: args.metrics_year,
      source_label: args.source_label,
      confirm_plan_hash: args.confirm_plan_hash,
      receipt_path: args.receipt_path,
      plan_path: args.plan_path,
      easyscholar_cache_path: args.easyscholar_cache_path,
      limit: args.limit,
    });
    const reasons = Object.entries(result.skip_reasons)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(', ');
    const summary =
      `Metrics backfill ${result.mode} ${result.status}: ${result.update} item(s) ${result.mode === 'dry_run' ? 'would update' : 'updated'}, ` +
      `${result.skip} skipped${reasons ? ` (${reasons})` : ''}; EasyScholar journals matched ${result.easyscholar.matched}/${result.easyscholar.unique_journals} ` +
      `(${result.easyscholar.cache_hits} cache hit(s), ${result.easyscholar.api_calls} API call(s)${result.easyscholar.key_configured ? '' : ', key not configured'}). ` +
      `${result.version_refreshes} local/cloud version refresh(es); ${result.conflict_summary.cloud_version_moved} cloud-version-moved conflict(s). ` +
      `plan_hash ${result.plan_hash}.${result.mode === 'dry_run' ? ' Review, then call apply with mode: apply, confirm_plan_hash, and receipt_path.' : ''}`;
    return ok({ ...result }, summary);
  },
};
export default backfillMetricsTool;
