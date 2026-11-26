import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const DEDUPE_PLAN_SCHEMA_VERSION = '1.0.0';

/** A freshly fetched Zotero item plus its resolved child attachment and note keys. */
export interface FreshItemRecord {
  item: any;
  children: { attachments: string[]; notes: string[] };
}

export interface DedupePreStep {
  step: 'add_master_to_collection' | 'add_master_to_batch_tag';
  item_key: string;
  collection_key?: string;
  tag?: string;
  already_satisfied: boolean;
  reason: string;
}

export interface DedupePlanCluster {
  cluster_id: string;
  confidence: 'high' | 'medium' | 'review';
  reasons: string[];
  master_key: string;
  master_title: string;
  master_version: number | null;
  merge_keys: string[];
  master_outside_scope: boolean;
  pre_steps: DedupePreStep[];
  item_versions: Array<{ key: string; version: number | null }>;
  keep: {
    attachments: { keys: string[]; policy: string };
    notes: { keys: string[]; policy: string };
    tags: { union: string[]; policy: string };
    collections: { union: string[]; policy: string };
    relations: {
      existing: Array<{ item_key: string; relations: Record<string, unknown> }>;
      dc_replaces_after_merge: string[];
      policy: string;
    };
  };
  trash: {
    keys: string[];
    destination: 'trash';
    recoverable: true;
    permanent_delete: false;
    policy: string;
  };
  verification: {
    keys_checked: number;
    version_changes: Array<{ key: string; report_version: number | null; current_version: number | null }>;
    scope_membership: Array<{ key: string; in_batch_scope: boolean | null }>;
  };
}

export interface DedupePlan {
  schema_version: typeof DEDUPE_PLAN_SCHEMA_VERSION;
  plan_type: 'zotero-dedupe-plan';
  plan_id: string;
  created_at: string;
  plan_hash: string;
  source: {
    kind: 'duplicates_report' | 'collection_scan' | 'plan_file';
    report_path?: string;
    report_id?: string;
    collection_key?: string;
    plan_path?: string;
  };
  library: { type: 'user' | 'group'; id: number };
  batch_selector: { collection_key?: string; tag?: string };
  policy: {
    zotero_writes: false;
    needs_plugin: true;
    native_merge_required: true;
    merged_items_destination: 'trash';
    recoverable: true;
    permanent_delete: false;
  };
  cluster_count: number;
  clusters: DedupePlanCluster[];
}

const ATTACHMENT_POLICY =
  'Every child attachment (PDF, snapshot, linked file) of each merged item is kept and re-parented to the master by the native merge; none are deleted.';
const NOTE_POLICY =
  'Every child note of each merged item is kept and re-parented to the master by the native merge; none are deleted.';
const TAG_POLICY =
  'Tags from every merged item are unioned onto the master; no tags are discarded.';
const COLLECTION_POLICY =
  'The master is added to every collection of each merged item, so no collection membership is lost.';
const RELATION_POLICY =
  'Existing relations are preserved, and the native merge records a dc:replaces relation from the master to each merged-away item.';
const TRASH_POLICY =
  'Merged-away items are moved to the Zotero trash and can be restored from there; permanent deletion is forbidden.';

function dataOf(item: any): any {
  return item?.data ?? item ?? {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively sort object keys so the canonical hash is independent of field order. */
function deepSort(value: any): any {
  if (Array.isArray(value)) return value.map(deepSort);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = deepSort(value[key]);
    return sorted;
  }
  return value;
}

/**
 * The plan hash covers everything the merge would do and the library state it was
 * planned against (item versions included), but not volatile bookkeeping fields
 * (plan_id, created_at, source paths).
 */
export function canonicalDedupePlanHash(plan: DedupePlan): string {
  const payload = {
    schema_version: plan.schema_version,
    plan_type: plan.plan_type,
    library: plan.library,
    batch_selector: plan.batch_selector,
    policy: plan.policy,
    clusters: [...plan.clusters].sort((a, b) => a.cluster_id.localeCompare(b.cluster_id)),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(deepSort(payload)), 'utf8').digest('hex')}`;
}

/** Load a saved dedupe plan file and verify its embedded hash. */
export async function readDedupePlan(path: string): Promise<DedupePlan> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error: any) {
    if (error?.code === 'ENOENT')
      throw new Error(
        `Dedupe plan not found: ${path}. Run zotero_apply_dedupe_plan in dry_run mode first to generate one.`,
      );
    throw new Error(`Could not read the dedupe plan: ${error?.message ?? String(error)}`);
  }
  if (
    !isObject(value) ||
    value.schema_version !== DEDUPE_PLAN_SCHEMA_VERSION ||
    value.plan_type !== 'zotero-dedupe-plan' ||
    !Array.isArray(value.clusters) ||
    !isObject(value.policy) ||
    !isObject(value.batch_selector)
  )
    throw new Error('Not a valid zotero-dedupe-plan file: schema_version, plan_type, or clusters missing.');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(value.plan_hash ?? '')))
    throw new Error('Invalid dedupe plan hash: expected sha256:<64 lowercase hex>.');
  // SAFETY: value is not a validated DedupePlan yet; the field checks above cover its
  // shape, and the hash recomputation immediately below verifies the full content.
  const plan = value as unknown as DedupePlan;
  if (canonicalDedupePlanHash(plan) !== plan.plan_hash)
    throw new Error('Dedupe plan hash mismatch: the plan file was modified or truncated. Re-run the dry-run to regenerate the plan.');
  return plan;
}

function tagNames(data: any): string[] {
  return (Array.isArray(data.tags) ? data.tags : [])
    .map((tag: any) => (typeof tag === 'string' ? tag : String(tag?.tag ?? '')))
    .filter(Boolean);
}

function versionOf(item: any): number | null {
  const version = item?.version ?? dataOf(item).version;
  return Number.isInteger(version) ? Number(version) : null;
}

function scopeMembership(
  fresh: FreshItemRecord,
  scope: { collection_key?: string; tag?: string },
): boolean | null {
  const data = dataOf(fresh.item);
  if (scope.collection_key)
    return Array.isArray(data.collections) && data.collections.includes(scope.collection_key);
  if (scope.tag) return tagNames(data).includes(scope.tag);
  return null;
}

function preStepsFor(
  masterKey: string,
  masterOutsideScope: boolean,
  scope: { collection_key?: string; tag?: string },
  masterMembership: boolean | null,
): DedupePreStep[] {
  if (!masterOutsideScope) return [];
  if (scope.collection_key) {
    return [
      {
        step: 'add_master_to_collection',
        item_key: masterKey,
        collection_key: scope.collection_key,
        already_satisfied: masterMembership === true,
        reason:
          'The recommended master is outside the batch collection. Add it to the collection before the merge, otherwise the work disappears from the batch once the in-scope copies are merged away.',
      },
    ];
  }
  if (scope.tag) {
    return [
      {
        step: 'add_master_to_batch_tag',
        item_key: masterKey,
        tag: scope.tag,
        already_satisfied: masterMembership === true,
        reason:
          'The recommended master is outside the batch tag. Add the batch tag to the master (a manual step in Zotero Desktop) before the merge, otherwise the work disappears from the batch once the in-scope copies are merged away.',
      },
    ];
  }
  return [];
}

/**
 * Turn order-07 report clusters into reviewable merge-plan clusters using freshly
 * fetched items. Pure: no IO, so tests can drive it with plain fixtures.
 */
export function buildPlanClusters(
  reportClusters: any[],
  fresh: Map<string, FreshItemRecord>,
  scope: { collection_key?: string; tag?: string },
): DedupePlanCluster[] {
  return reportClusters
    .map((cluster) => {
      const masterKey = String(cluster.recommended_master_key);
      const keys: string[] = (Array.isArray(cluster.items) ? cluster.items : [])
        .map((item: any) => String(item?.key ?? ''))
        .filter(Boolean);
      const mergeKeys = [...new Set(keys.filter((key: string) => key !== masterKey))].sort();
      const masterFresh = fresh.get(masterKey)!;
      const masterData = dataOf(masterFresh?.item);
      const masterOutsideScope = Boolean(cluster.master_outside_scope);
      const memberships: Array<{ key: string; in_batch_scope: boolean | null }> = keys.map(
        (key: string) => ({
          key,
          in_batch_scope: fresh.has(key) ? scopeMembership(fresh.get(key)!, scope) : null,
        }),
      );
      const attachments: string[] = [];
      const notes: string[] = [];
      const tagUnion = new Set<string>();
      const collectionUnion = new Set<string>();
      const relations: Array<{ item_key: string; relations: Record<string, unknown> }> = [];
      const versionChanges: DedupePlanCluster['verification']['version_changes'] = [];
      const versions: DedupePlanCluster['item_versions'] = [];
      for (const key of keys) {
        const record = fresh.get(key);
        if (!record) continue;
        const data = dataOf(record.item);
        attachments.push(...record.children.attachments);
        notes.push(...record.children.notes);
        for (const tag of tagNames(data)) tagUnion.add(tag);
        for (const collection of Array.isArray(data.collections) ? data.collections : [])
          if (collection) collectionUnion.add(String(collection));
        if (isObject(data.relations) && Object.keys(data.relations).length)
          relations.push({ item_key: key, relations: data.relations });
        const currentVersion = versionOf(record.item);
        versions.push({ key, version: currentVersion });
        const reportVersion = Number(
          (Array.isArray(cluster.items) ? cluster.items : []).find((item: any) => String(item?.key) === key)
            ?.version ?? null,
        );
        const reportVersionOrNull = Number.isInteger(reportVersion) ? reportVersion : null;
        if (currentVersion !== reportVersionOrNull)
          versionChanges.push({ key, report_version: reportVersionOrNull, current_version: currentVersion });
      }
      return {
        cluster_id: String(cluster.cluster_id),
        confidence: cluster.confidence ?? 'review',
        reasons: Array.isArray(cluster.reasons) ? cluster.reasons : [],
        master_key: masterKey,
        master_title: String(masterData.title ?? ''),
        master_version: versionOf(masterFresh?.item),
        merge_keys: mergeKeys,
        master_outside_scope: masterOutsideScope,
        pre_steps: preStepsFor(
          masterKey,
          masterOutsideScope,
          scope,
          memberships.find((entry: { key: string; in_batch_scope: boolean | null }) => entry.key === masterKey)
            ?.in_batch_scope ?? null,
        ),
        item_versions: versions,
        keep: {
          attachments: { keys: [...new Set(attachments)].sort(), policy: ATTACHMENT_POLICY },
          notes: { keys: [...new Set(notes)].sort(), policy: NOTE_POLICY },
          tags: { union: [...tagUnion].sort(), policy: TAG_POLICY },
          collections: { union: [...collectionUnion].sort(), policy: COLLECTION_POLICY },
          relations: {
            existing: relations,
            dc_replaces_after_merge: mergeKeys,
            policy: RELATION_POLICY,
          },
        },
        trash: {
          keys: mergeKeys,
          destination: 'trash',
          recoverable: true,
          permanent_delete: false,
          policy: TRASH_POLICY,
        },
        verification: {
          keys_checked: keys.length,
          version_changes: versionChanges,
          scope_membership: memberships,
        },
      } satisfies DedupePlanCluster;
    })
    .sort((a, b) => a.cluster_id.localeCompare(b.cluster_id));
}
