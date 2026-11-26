import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LibraryRef } from '../api/web-client.js';
import { ZoteroApiError } from '../api/errors.js';
import { findDuplicateClusters } from '../features/duplicates/detector.js';
import {
  DEDUPE_PLAN_SCHEMA_VERSION,
  buildPlanClusters,
  canonicalDedupePlanHash,
  readDedupePlan,
  type DedupePlan,
  type DedupePlanCluster,
  type FreshItemRecord,
} from '../features/duplicates/plan.js';
import { LIBRARY_SCAN_MAX_ITEMS, annotateMasterScope, listScope } from './find-duplicates.js';
import type { ToolContext, ToolDefinition, ToolHandlerResult } from '../registry/registry.js';
import { ok } from '../registry/registry.js';

function err(text: string): ToolHandlerResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** Fresh read-only verification of every key a plan or report still names. */
async function fetchFreshItems(
  ctx: ToolContext,
  library: LibraryRef | undefined,
  keys: Iterable<string>,
): Promise<{ fresh: Map<string, FreshItemRecord>; missing: string[] }> {
  const fresh = new Map<string, FreshItemRecord>();
  const missing: string[] = [];
  for (const key of keys) {
    try {
      const item = await ctx.router.getItem(key, { library });
      const children: FreshItemRecord['children'] = { attachments: [], notes: [] };
      const numChildren = Number(item?.meta?.numChildren ?? 0);
      if (numChildren > 0) {
        const result = await ctx.router.getItemChildren(key, { library });
        for (const child of result?.data ?? []) {
          const itemType = String(child?.data?.itemType ?? '');
          const childKey = String(child?.key ?? '');
          if (!childKey) continue;
          if (itemType === 'attachment') children.attachments.push(childKey);
          else if (itemType === 'note' || itemType === 'annotation') children.notes.push(childKey);
        }
      }
      fresh.set(key, { item, children });
    } catch (error) {
      if (error instanceof ZoteroApiError && error.status === 404) {
        missing.push(key);
        continue;
      }
      throw error;
    }
  }
  return { fresh, missing };
}

/** Re-check a saved plan read-only: keys still exist; report drift since the plan was hashed. */
async function verifySavedPlan(
  ctx: ToolContext,
  library: LibraryRef | undefined,
  plan: DedupePlan,
): Promise<{ error?: string; version_changes: DedupePlanCluster['verification']['version_changes'] }> {
  const keys = plan.clusters.flatMap((cluster) => [cluster.master_key, ...cluster.merge_keys]);
  const { fresh, missing } = await fetchFreshItems(ctx, library, keys);
  if (missing.length)
    return {
      error: `The dedupe plan is stale: item key(s) ${missing.join(', ')} no longer exist in the library. Re-run zotero_find_duplicates and plan from a fresh report.`,
      version_changes: [],
    };
  const versionChanges: DedupePlanCluster['verification']['version_changes'] = [];
  for (const cluster of plan.clusters) {
    for (const entry of cluster.item_versions) {
      const record = fresh.get(entry.key);
      const current = record
        ? Number(record.item?.version ?? record.item?.data?.version ?? null)
        : null;
      const currentVersion = Number.isInteger(current) ? current : null;
      if (currentVersion !== entry.version)
        versionChanges.push({ key: entry.key, report_version: entry.version, current_version: currentVersion });
    }
  }
  return { version_changes: versionChanges };
}

const applyDedupePlan: ToolDefinition = {
  name: 'zotero_apply_dedupe_plan',
  title: 'Plan and dry-run a Zotero duplicate merge without writing Zotero',
  description:
    'Turns a zotero_find_duplicates report (or a batch collection key, scanned first) into a reviewable, hashed merge plan. dry_run re-checks read-only that every key still exists, reports current versions and batch membership, and describes exactly what a native Zotero merge would keep (attachments, notes, tags, collections, and relations including dc:replaces) and which merged-away items would move to the trash (recoverable; permanent deletion is forbidden). It never writes Zotero. Clusters whose recommended master is outside the batch get an add-master-to-collection step first. apply only saves and validates the plan file under the data directory and returns needs_plugin/native_merge_required, because executing the merge needs Zotero native merge; it must never be replaced by trashing items by hand. zotero_trash_items and zotero_delete_items are not part of the workbench profile.',
  inputSchema: {
    mode: z
      .enum(['dry_run', 'apply'])
      .optional()
      .describe('Default "dry_run": read-only checks and the plan, nothing written. "apply" saves and validates the plan file; it still never writes Zotero.'),
    report_path: z
      .string()
      .min(1)
      .optional()
      .describe('Path to a zotero_find_duplicates JSON report. Provide exactly one input source.'),
    plan_path: z
      .string()
      .min(1)
      .optional()
      .describe('Path to a saved dedupe plan file, to re-validate it and its plan_hash.'),
    collection_key: z
      .string()
      .min(1)
      .optional()
      .describe('Batch collection key; the duplicate scan runs first (requires the explicit limit).'),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Explicit maximum item count for the selected batch; required with collection_key.'),
    title_threshold: z
      .number()
      .min(0.8)
      .max(1)
      .optional()
      .describe('Review-candidate title similarity threshold for an internal scan; default 0.85.'),
    expected_plan_hash: z
      .string()
      .min(1)
      .optional()
      .describe('The plan_hash the user approved; checked against plan_path before any validation.'),
    library_type: z.enum(['user', 'group']).optional(),
    library_id: z.number().int().optional(),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (args, ctx) => {
    const mode = args.mode ?? 'dry_run';
    const sources = [args.report_path, args.plan_path, args.collection_key].filter(Boolean);
    if (sources.length !== 1)
      return err('Provide exactly one of `report_path`, `plan_path`, or `collection_key`.');
    if (args.expected_plan_hash && !args.plan_path)
      return err('`expected_plan_hash` requires `plan_path`.');
    const library: LibraryRef | undefined = args.library_id
      ? { type: (args.library_type ?? 'group') as 'user' | 'group', id: args.library_id }
      : undefined;
    const resolvedLibrary = library ?? ctx.router.defaultLibrary();

    // Re-validate a previously saved plan: no new plan is built, nothing is written.
    if (args.plan_path) {
      let plan: DedupePlan;
      try {
        plan = await readDedupePlan(args.plan_path);
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
      if (args.expected_plan_hash && args.expected_plan_hash !== plan.plan_hash)
        return err(
          `Dedupe plan hash mismatch: expected ${args.expected_plan_hash}, the file has ${plan.plan_hash}. Re-run the dry-run for the current plan.`,
        );
      if (
        plan.library.type !== resolvedLibrary.type ||
        Number(plan.library.id) !== Number(resolvedLibrary.id)
      )
        return err(
          `The dedupe plan was generated for library ${plan.library.type}/${plan.library.id}, but this run targets ${resolvedLibrary.type}/${resolvedLibrary.id}. Pass matching library_type/library_id.`,
        );
      let verification;
      try {
        verification = await verifySavedPlan(ctx, library, plan);
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
      if (verification.error) return err(verification.error);
      const summary =
        `Dedupe plan ${mode === 'apply' ? 'validated' : 're-validated'}: ${plan.cluster_count} cluster(s), ` +
        `${plan.clusters.reduce((count, cluster) => count + cluster.merge_keys.length, 0)} item(s) would move to the trash (recoverable). ` +
        `No Zotero writes were made. Executing the merge needs the Zotero native-merge plugin (needs_plugin).`;
      return ok(
        {
          mode,
          ...(mode === 'apply' ? { status: 'needs_plugin' } : {}),
          plan,
          plan_hash: plan.plan_hash,
          cluster_count: plan.cluster_count,
          needs_plugin: true,
          native_merge_required: true,
          zotero_writes: false,
          verification,
        },
        summary,
      );
    }

    // Build the plan from a saved duplicates report or a fresh collection scan.
    let reportClusters: any[];
    let batchSelector: { collection_key?: string; tag?: string };
    const source: DedupePlan['source'] = args.report_path
      ? { kind: 'duplicates_report', report_path: args.report_path }
      : { kind: 'collection_scan', collection_key: args.collection_key };
    if (args.collection_key) {
      if (!Number.isInteger(args.limit) || args.limit < 1)
        return err(
          'Provide an explicit positive integer `limit` with `collection_key`; duplicate scans never use a silent cap.',
        );
      let batch;
      let fullLibrary;
      try {
        batch = await listScope(
          ctx,
          { library, collectionKey: args.collection_key },
          args.limit,
          'batch',
        );
        fullLibrary = await listScope(ctx, { library }, LIBRARY_SCAN_MAX_ITEMS, 'library');
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
      const rawClusters = findDuplicateClusters(batch.items, fullLibrary.items, {
        titleThreshold: args.title_threshold,
      });
      reportClusters = annotateMasterScope(rawClusters, 'collection', args.collection_key).clusters;
      batchSelector = { collection_key: args.collection_key };
    } else {
      let report: any;
      try {
        report = JSON.parse(await readFile(args.report_path, 'utf8'));
      } catch (error: any) {
        if (error?.code === 'ENOENT')
          return err(
            `Duplicate report not found: ${args.report_path}. Run zotero_find_duplicates first and pass the reportPath it returned.`,
          );
        return err(`Could not read the duplicate report: ${error?.message ?? String(error)}`);
      }
      if (!report || !Array.isArray(report.clusters) || !report.batch_selector)
        return err(
          `Not a valid zotero_find_duplicates report: ${args.report_path} is missing clusters or batch_selector.`,
        );
      if (
        report.library &&
        (String(report.library.type) !== resolvedLibrary.type ||
          Number(report.library.id) !== Number(resolvedLibrary.id))
      )
        return err(
          `The duplicate report was generated for library ${report.library.type}/${report.library.id}, but this run targets ${resolvedLibrary.type}/${resolvedLibrary.id}. Pass matching library_type/library_id.`,
        );
      reportClusters = report.clusters;
      batchSelector = report.batch_selector;
      source.report_id = report.report_id;
    }

    const keys = [
      ...new Set(
        reportClusters.flatMap((cluster: any) =>
          (Array.isArray(cluster.items) ? cluster.items : [])
            .map((item: any) => String(item?.key ?? ''))
            .filter(Boolean),
        ),
      ),
    ];
    let fresh: Map<string, FreshItemRecord>;
    try {
      const fetched = await fetchFreshItems(ctx, library, keys);
      fresh = fetched.fresh;
      if (fetched.missing.length)
        return err(
          `The duplicate report is stale: item key(s) ${fetched.missing.join(', ')} no longer exist in the library. Re-run zotero_find_duplicates and plan from the fresh report.`,
        );
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }

    const clusters = buildPlanClusters(reportClusters, fresh, batchSelector);
    const masterOutsideScopeCount = clusters.filter((cluster) => cluster.master_outside_scope).length;
    const createdAt = new Date().toISOString();
    const plan: DedupePlan = {
      schema_version: DEDUPE_PLAN_SCHEMA_VERSION,
      plan_type: 'zotero-dedupe-plan',
      plan_id: '',
      created_at: createdAt,
      plan_hash: '',
      source,
      library: resolvedLibrary,
      batch_selector: batchSelector,
      policy: {
        zotero_writes: false,
        needs_plugin: true,
        native_merge_required: true,
        merged_items_destination: 'trash',
        recoverable: true,
        permanent_delete: false,
      },
      cluster_count: clusters.length,
      clusters,
    };
    plan.plan_hash = canonicalDedupePlanHash(plan);

    if (mode === 'dry_run') {
      const mergeCount = clusters.reduce((count, cluster) => count + cluster.merge_keys.length, 0);
      return ok(
        {
          mode: 'dry_run',
          plan,
          plan_hash: plan.plan_hash,
          cluster_count: clusters.length,
          master_outside_scope_count: masterOutsideScopeCount,
          items_to_merge_away: mergeCount,
          needs_plugin: true,
          native_merge_required: true,
          zotero_writes: false,
        },
        `Dedupe dry run: ${clusters.length} cluster(s) planned; ${mergeCount} item(s) would move to the trash (recoverable).` +
          (masterOutsideScopeCount
            ? ` ${masterOutsideScopeCount} cluster(s) need the master added to the batch first.`
            : '') +
          ' No Zotero writes were made. Show the plan to the user for approval; the merge itself runs through Zotero native merge.',
      );
    }

    // apply: only persist and validate the plan file. Never touch Zotero; the
    // merge execution path is the native-merge plugin, which reports needs_plugin.
    plan.plan_id = `dedupe-plan-${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const planDirectory = join(ctx.config.dataDir, 'dedupe-plans');
    const planPath = join(planDirectory, `${plan.plan_id}.json`);
    try {
      await mkdir(planDirectory, { recursive: true });
      await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      const saved = await readDedupePlan(planPath);
      if (saved.plan_hash !== plan.plan_hash)
        return err('The saved plan file failed its hash validation after writing; nothing was merged.');
    } catch (error) {
      return err(
        `Could not persist or validate the dedupe plan: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return ok(
      {
        mode: 'apply',
        status: 'needs_plugin',
        plan_id: plan.plan_id,
        plan_path: planPath,
        plan_hash: plan.plan_hash,
        cluster_count: clusters.length,
        master_outside_scope_count: masterOutsideScopeCount,
        needs_plugin: true,
        native_merge_required: true,
        zotero_writes: false,
        merged_items_destination: 'trash',
        recoverable: true,
        permanent_delete: false,
      },
      `Dedupe plan saved and validated at ${planPath}. Executing the merge needs the Zotero native-merge plugin, which is not available in this server (needs_plugin / native_merge_required). Show the plan and its plan_hash to the user for approval; do not trash or delete the duplicates by hand — merged-away items only move to the trash (recoverable) when the native merge runs.`,
    );
  },
};

export default applyDedupePlan;
