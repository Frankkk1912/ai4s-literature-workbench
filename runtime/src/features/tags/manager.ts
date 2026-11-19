import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { LibraryRef } from '../../api/web-client.js';
import type { ToolContext } from '../../registry/registry.js';
import {
  canonicalLabel,
  comparisonKey,
  normalizedAlias,
  semanticLabel,
  semanticTag,
  stableUnique,
  type SemanticVocabulary,
  type VocabularyEntry,
} from '../semantic-tags/contract.js';
import {
  loadVocabulary,
  saveVocabulary,
  semanticTagsDirectory,
  validateVocabulary,
  vocabularyLookup,
  vocabularyPath,
  withVocabularyLock,
} from '../semantic-tags/vocabulary.js';
import {
  findDuplicateClusters,
  isProtectedTag,
  vocabularyEntryUnused,
  type LibraryTag,
} from './duplicates.js';

export interface TagOperation {
  op: 'merge' | 'rename' | 'delete_unused';
  loser?: string;
  winner?: string;
  from?: string;
  to?: string;
  tag?: string;
  tags?: string[];
}

interface Retag { from: string; to: string }
interface ItemTag { tag: string; type?: number }
interface ItemAction {
  item_key: string;
  expected_version: number;
  title: string;
  before_tags: ItemTag[];
  after_tags: ItemTag[];
}

const TAG_CAP = 5000;

export function normalizeTags(raw: unknown): ItemTag[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (typeof entry === 'string') return { tag: entry };
    const tag = String(entry?.tag ?? '');
    if (!tag) return { tag: '' };
    if (entry?.type === undefined || entry.type === 0) return { tag };
    return { tag, type: entry.type };
  }).filter((entry) => entry.tag);
}

export function sameTags(left: ItemTag[], right: ItemTag[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyRetags(tags: ItemTag[], retags: Retag[]): { next: ItemTag[]; changed: boolean } {
  let current = tags.map((tag) => ({ ...tag }));
  let changed = false;
  for (const retag of retags) {
    if (!current.some((tag) => tag.tag === retag.from)) continue;
    const hasWinner = current.some((tag) => tag.tag === retag.to);
    current = current.filter((tag) => tag.tag !== retag.from);
    if (!hasWinner) current.push({ tag: retag.to });
    changed = true;
  }
  return { next: current, changed };
}

function labelOf(tag: string): string {
  return semanticLabel(tag) ?? tag;
}

function timestampName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSort);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'plan_hash')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, deepSort(entry)]));
  }
  return value;
}

export function tagManagerPlanHash(plan: Record<string, unknown>): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(deepSort(plan))).digest('hex')}`;
}

async function persist(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

function managerPaths(dataDir: string, library: LibraryRef, stem: string): { planPath: string; receiptPath: string } {
  const root = join(semanticTagsDirectory(dataDir, library), 'tag-manager');
  return {
    planPath: join(root, 'plans', `${stem}.json`),
    receiptPath: join(root, 'receipts', `${stem}.json`),
  };
}

export async function listAllLibraryTags(
  ctx: ToolContext,
  library: LibraryRef,
): Promise<{ tags: LibraryTag[]; truncated: boolean }> {
  const tags: LibraryTag[] = [];
  let start = 0;
  let truncated = false;
  for (;;) {
    const page = await ctx.web.listTags(library, { limit: 100, start });
    for (const entry of page.data) {
      if (tags.length >= TAG_CAP) {
        truncated = true;
        break;
      }
      if (typeof entry === 'string') tags.push({ name: entry, auto: false });
      else tags.push({
        name: String(entry?.tag ?? ''),
        numItems: typeof entry?.meta?.numItems === 'number' ? entry.meta.numItems : undefined,
        auto: entry?.meta?.type === 1,
      });
    }
    start += page.data.length;
    if (truncated || !page.data.length || start >= page.totalResults) break;
  }
  return { tags: tags.filter((tag) => tag.name), truncated };
}

function versionOf(item: any): number | null {
  const value = item?.version ?? item?.data?.version;
  return Number.isInteger(value) ? value : null;
}

function requireTag(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty tag string`);
  return value;
}

function normalizeOperations(operations: TagOperation[]): { retags: Retag[]; deletions: string[] } {
  if (!Array.isArray(operations) || !operations.length) throw new Error('At least one operation is required');
  const retags: Retag[] = [];
  const deletions: string[] = [];
  for (const [index, operation] of operations.entries()) {
    if (operation.op === 'merge') {
      retags.push({ from: requireTag(operation.loser, `operations[${index}].loser`), to: requireTag(operation.winner, `operations[${index}].winner`) });
    } else if (operation.op === 'rename') {
      retags.push({ from: requireTag(operation.from, `operations[${index}].from`), to: requireTag(operation.to, `operations[${index}].to`) });
    } else if (operation.op === 'delete_unused') {
      const names = [...(operation.tags ?? [])];
      if (operation.tag) names.push(operation.tag);
      if (!names.length) throw new Error(`operations[${index}].tags is required for delete_unused`);
      deletions.push(...names.map((tag, tagIndex) => requireTag(tag, `operations[${index}].tags[${tagIndex}]`)));
    } else {
      throw new Error(`operations[${index}].op is invalid`);
    }
  }
  const sources = new Set<string>();
  const destinations = new Set<string>();
  for (const retag of retags) {
    if (retag.from === retag.to) throw new Error(`Tag "${retag.from}" cannot be merged into itself`);
    if (sources.has(retag.from)) throw new Error(`Tag "${retag.from}" has more than one destination. Plan one hop at a time.`);
    sources.add(retag.from);
    destinations.add(retag.to);
  }
  for (const source of sources) {
    if (destinations.has(source)) {
      throw new Error(`Tag "${source}" is both a source and a destination. Plan one hop at a time.`);
    }
  }
  const uniqueDeletions: string[] = [];
  for (const tag of deletions) {
    if (sources.has(tag) || destinations.has(tag)) {
      throw new Error(`Tag "${tag}" cannot be deleted in the same plan that merges or renames it`);
    }
    if (!uniqueDeletions.includes(tag)) uniqueDeletions.push(tag);
  }
  return { retags, deletions: uniqueDeletions };
}

function namedTags(retags: Retag[], deletions: string[]): string[] {
  return [...retags.flatMap((retag) => [retag.from, retag.to]), ...deletions];
}

function tagIsKnown(name: string, libraryTags: LibraryTag[], vocabulary: SemanticVocabulary): boolean {
  if (libraryTags.some((tag) => tag.name === name)) return true;
  const lookup = vocabularyLookup(vocabulary);
  return Boolean(lookup.get(comparisonKey(labelOf(name))) || lookup.get(comparisonKey(name)));
}

function findEntry(vocabulary: SemanticVocabulary, tag: string): VocabularyEntry | undefined {
  const lookup = vocabularyLookup(vocabulary);
  return lookup.get(comparisonKey(labelOf(tag))) ?? lookup.get(comparisonKey(tag));
}

function tryAlias(value: string): string | null {
  try { return normalizedAlias(value); }
  catch { return null; }
}

function hasAlias(entry: VocabularyEntry, alias: string): boolean {
  return entry.aliases.some((candidate) => comparisonKey(candidate) === comparisonKey(alias));
}

export interface VocabularyUpdate {
  vocabulary: SemanticVocabulary | null;
  folded: Array<{ id: string; canonical: string; dimension: string; aliases: string[]; into: string }>;
  renamed: Array<{ id: string; from: string; to: string }>;
  aliases_added: Array<{ id: string; alias: string }>;
  alias_skipped: Array<{ tag: string; reason: string }>;
  removed_entries: string[];
}

export function updateVocabulary(
  vocabulary: SemanticVocabulary,
  retags: Retag[],
  deletions: Array<{ tag: string; remove_entry: boolean }>,
  libraryTags: LibraryTag[],
  itemActions: ItemAction[],
  now: string,
): VocabularyUpdate {
  const next = structuredClone(vocabulary);
  const folded: VocabularyUpdate['folded'] = [];
  const renamed: VocabularyUpdate['renamed'] = [];
  const aliasesAdded: VocabularyUpdate['aliases_added'] = [];
  const aliasSkipped: VocabularyUpdate['alias_skipped'] = [];
  const removed: string[] = [];
  const touched = new Set<string>();
  let changed = false;

  const rememberAlias = (entry: VocabularyEntry, raw: string) => {
    const alias = tryAlias(raw);
    if (!alias) {
      if (raw.trim()) aliasSkipped.push({ tag: raw, reason: 'not an English alias' });
      return;
    }
    if (comparisonKey(alias) === comparisonKey(entry.canonical) || hasAlias(entry, alias)) return;
    entry.aliases = stableUnique([...entry.aliases, alias]);
    aliasesAdded.push({ id: entry.id, alias });
    entry.updated_at = now;
    touched.add(entry.id);
    changed = true;
  };

  for (const retag of retags) {
    const loser = findEntry(next, retag.from);
    const winner = findEntry(next, retag.to);
    if (loser && winner && loser.id === winner.id) {
      rememberAlias(winner, labelOf(retag.from));
      continue;
    }
    if (loser && winner && loser.id !== winner.id) {
      if (loser.dimension !== winner.dimension) {
        throw new Error(
          `Cannot merge vocabulary entries ${loser.id} (${loser.dimension}) and ${winner.id} (${winner.dimension}): dimensions differ. Pick one dimension before merging.`,
        );
      }
      for (const raw of [loser.canonical, ...loser.aliases, labelOf(retag.from)]) rememberAlias(winner, raw);
      winner.collection_keys = stableUnique([...winner.collection_keys, ...loser.collection_keys]).sort();
      winner.updated_at = now;
      folded.push({
        id: loser.id, canonical: loser.canonical, dimension: loser.dimension,
        aliases: [...loser.aliases], into: winner.id,
      });
      next.tags = next.tags.filter((entry) => entry.id !== loser.id);
      touched.add(winner.id);
      changed = true;
      continue;
    }
    if (loser && !winner) {
      if (!semanticLabel(retag.to)) {
        throw new Error(
          `Refusing to detach vocabulary entry ${loser.id} ("${loser.canonical}") onto non-semantic tag "${retag.to}". The destination must be AI4S:Semantic:<canonical English> or an existing vocabulary label.`,
        );
      }
      let canonical: string;
      try { canonical = canonicalLabel(labelOf(retag.to)); }
      catch (error) {
        throw new Error(`Cannot rename vocabulary canonical "${loser.canonical}" to "${retag.to}": ${error instanceof Error ? error.message : String(error)}`);
      }
      if (comparisonKey(canonical) !== comparisonKey(loser.canonical)) {
        const previous = loser.canonical;
        loser.canonical = canonical;
        const kept = tryAlias(previous);
        loser.aliases = stableUnique([...(kept ? [kept] : []), ...loser.aliases])
          .filter((alias) => comparisonKey(alias) !== comparisonKey(canonical));
        loser.updated_at = now;
        renamed.push({ id: loser.id, from: previous, to: canonical });
        touched.add(loser.id);
        changed = true;
      }
      continue;
    }
    if (!loser && winner) rememberAlias(winner, labelOf(retag.from));
  }

  for (const deletion of deletions) {
    if (!deletion.remove_entry) continue;
    const entry = findEntry(next, deletion.tag);
    if (!entry) continue;
    if (comparisonKey(labelOf(deletion.tag)) !== comparisonKey(entry.canonical)) continue;
    if (!vocabularyEntryUnused(entry, libraryTags)) {
      throw new Error(
        `Semantic tag "${deletion.tag}" has no item count, but vocabulary entry ${entry.id} is still referenced by another live tag. Refusing to delete the vocabulary entry.`,
      );
    }
    next.tags = next.tags.filter((candidate) => candidate.id !== entry.id);
    removed.push(entry.id);
    changed = true;
  }

  const affectedLabels = new Set<string>();
  for (const action of itemActions) {
    for (const tag of [...action.before_tags, ...action.after_tags]) {
      const label = semanticLabel(tag.tag);
      if (label) affectedLabels.add(comparisonKey(label));
    }
  }
  for (const entry of next.tags) {
    if (!touched.has(entry.id) && !affectedLabels.has(comparisonKey(entry.canonical))) continue;
    const exact = semanticTag(entry.canonical);
    const listed = libraryTags.find((tag) => tag.name === exact);
    // A tag Zotero did not list contributes nothing. A listed tag with no count keeps the stored count.
    let count = listed ? (listed.numItems ?? entry.usage_count) : 0;
    for (const action of itemActions) {
      const before = action.before_tags.some((tag) => tag.tag === exact);
      const after = action.after_tags.some((tag) => tag.tag === exact);
      if (before && !after) count -= 1;
      if (!before && after) count += 1;
    }
    count = Math.max(0, count);
    if (count !== entry.usage_count) {
      entry.usage_count = count;
      entry.updated_at = now;
      touched.add(entry.id);
      changed = true;
    }
  }

  if (!changed) {
    return { vocabulary: null, folded, renamed, aliases_added: aliasesAdded, alias_skipped: aliasSkipped, removed_entries: removed };
  }
  next.revision += 1;
  next.updated_at = now;
  return {
    vocabulary: validateOrThrow(next),
    folded, renamed, aliases_added: aliasesAdded, alias_skipped: aliasSkipped, removed_entries: removed,
  };
}

function validateOrThrow(vocabulary: SemanticVocabulary): SemanticVocabulary {
  try {
    return validateVocabulary(vocabulary, vocabulary.library);
  } catch (error) {
    throw new Error(`Semantic vocabulary update is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function protectedTargets(names: string[], allowProtected: boolean): string[] {
  const hits = [...new Set(names.filter((name) => isProtectedTag(name)))];
  if (hits.length && !allowProtected) {
    throw new Error(
      `Refusing to change protected tags (${hits.join(', ')}). Pass allow_protected only when those exact tags were explicitly requested. AI4S:Priority:1-3, AI4S:ArticleType:*, JCR:*, and CAS:* tags are otherwise left untouched.`,
    );
  }
  return hits;
}

async function itemsWithTag(
  ctx: ToolContext,
  library: LibraryRef,
  tag: string,
  maxItems: number,
): Promise<any[]> {
  const items: any[] = [];
  let start = 0;
  let total = 0;
  do {
    const page = await ctx.router.searchItems({
      library, tag, top: false, includeTrashed: false, limit: 100, start,
    });
    total = page.totalResults;
    if (total > maxItems) {
      throw new Error(`Tag "${tag}" is on ${total} items, above max_items ${maxItems}. Raise max_items (at most 1000) or split the change.`);
    }
    items.push(...page.data);
    start += page.data.length;
    if (!page.data.length) break;
  } while (start < total);
  return items;
}

async function confirmUnused(ctx: ToolContext, library: LibraryRef, tag: string): Promise<void> {
  const page = await ctx.router.searchItems({ library, tag, top: false, includeTrashed: false, limit: 1, start: 0 });
  if (page.totalResults > 0) {
    throw new Error(`Tag "${tag}" is still on ${page.totalResults} item(s). Refusing to delete a tag that is in use.`);
  }
}

export async function scanTagDuplicates(
  ctx: ToolContext,
  library: LibraryRef,
  options: { includeNear?: boolean; limit?: number } = {},
): Promise<Record<string, unknown>> {
  const [{ tags, truncated }, vocabulary] = await Promise.all([
    listAllLibraryTags(ctx, library),
    loadVocabulary(ctx.config.dataDir, library),
  ]);
  const scan = findDuplicateClusters(tags, vocabulary, { includeNear: options.includeNear, limit: options.limit });
  return {
    library, vocabulary_revision: vocabulary.revision, library_tag_count: tags.length,
    library_tags_truncated: truncated, vocabulary_entries: vocabulary.tags.length, ...scan,
  };
}

export async function listUnusedTags(
  ctx: ToolContext,
  library: LibraryRef,
  options: { includeProtected?: boolean; limit?: number } = {},
): Promise<Record<string, unknown>> {
  const limit = options.limit ?? 100;
  const [{ tags, truncated }, vocabulary] = await Promise.all([
    listAllLibraryTags(ctx, library),
    loadVocabulary(ctx.config.dataDir, library),
  ]);
  const libraryUnused = tags.filter((tag) => tag.numItems === 0 && (options.includeProtected || !isProtectedTag(tag.name)));
  const vocabularyUnused = vocabulary.tags.filter((entry) => vocabularyEntryUnused(entry, tags));
  return {
    library, vocabulary_revision: vocabulary.revision, library_tags_truncated: truncated,
    library_tags: libraryUnused.slice(0, limit).map((tag) => ({ name: tag.name, num_items: 0, auto: tag.auto, protected: isProtectedTag(tag.name) })),
    library_tags_omitted: Math.max(0, libraryUnused.length - limit),
    vocabulary_entries: vocabularyUnused.slice(0, limit).map((entry) => ({
      id: entry.id, canonical: entry.canonical, semantic_tag: semanticTag(entry.canonical),
      dimension: entry.dimension, aliases: entry.aliases, usage_count: entry.usage_count,
    })),
    vocabulary_entries_omitted: Math.max(0, vocabularyUnused.length - limit),
  };
}

export async function planTagChanges(
  ctx: ToolContext,
  library: LibraryRef,
  input: {
    operations: TagOperation[];
    expectedRevision: number;
    allowProtected?: boolean;
    maxItems?: number;
  },
): Promise<Record<string, unknown>> {
  const maxItems = input.maxItems ?? 200;
  if (maxItems < 1 || maxItems > 1000) throw new Error('max_items must be between 1 and 1000');
  const { retags, deletions } = normalizeOperations(input.operations);
  const protectedNames = protectedTargets(namedTags(retags, deletions), Boolean(input.allowProtected));
  const [{ tags: libraryTags }, vocabulary] = await Promise.all([
    listAllLibraryTags(ctx, library),
    loadVocabulary(ctx.config.dataDir, library),
  ]);
  if (vocabulary.revision !== input.expectedRevision) {
    throw new Error(`Semantic vocabulary revision changed: expected ${input.expectedRevision}, current ${vocabulary.revision}`);
  }
  for (const retag of retags) {
    if (!tagIsKnown(retag.from, libraryTags, vocabulary)) {
      throw new Error(`Tag "${retag.from}" is not in the library or the semantic vocabulary. No plan was written.`);
    }
  }
  const deletionPlans: Array<{
    tag: string;
    remove_entry: boolean;
    vocabulary_entry_id: string | null;
    effect: 'remove_vocabulary_entry' | 'already_unused';
  }> = [];
  for (const tag of deletions) {
    const libraryHit = libraryTags.find((candidate) => candidate.name === tag);
    const entry = findEntry(vocabulary, tag);
    const removesEntry = Boolean(
      entry && semanticLabel(tag) && comparisonKey(semanticLabel(tag)!) === comparisonKey(entry.canonical),
    );
    if (libraryHit && libraryHit.numItems !== 0) {
      const count = libraryHit.numItems === undefined ? 'an unknown number of' : String(libraryHit.numItems);
      throw new Error(`Tag "${tag}" is used by ${count} items. Refusing to delete a tag that is still on items.`);
    }
    if (!libraryHit && !removesEntry) {
      throw new Error(`Tag "${tag}" is not an unused library tag or an unused semantic vocabulary entry. No plan was written.`);
    }
    if (libraryHit) await confirmUnused(ctx, library, tag);
    if (removesEntry && entry && !vocabularyEntryUnused(entry, libraryTags)) {
      throw new Error(`Vocabulary entry ${entry.id} ("${entry.canonical}") is still used by another live tag. Refusing to delete it.`);
    }
    deletionPlans.push({
      tag,
      remove_entry: removesEntry,
      vocabulary_entry_id: removesEntry ? entry!.id : entry?.id ?? null,
      // Zotero stores tags on items. A zero-item tag has nothing to patch; a semantic canonical can still leave the vocabulary.
      effect: removesEntry ? 'remove_vocabulary_entry' : 'already_unused',
    });
  }

  const keys = new Set<string>();
  for (const retag of retags) {
    if (!libraryTags.some((tag) => tag.name === retag.from)) continue;
    const found = await itemsWithTag(ctx, library, retag.from, maxItems);
    for (const item of found) {
      const key = item?.key ?? item?.data?.key;
      if (key) keys.add(String(key));
    }
  }
  if (keys.size > maxItems) {
    throw new Error(`This plan touches ${keys.size} items, above max_items ${maxItems}. Raise max_items or split the change.`);
  }
  const itemActions: ItemAction[] = [];
  for (const key of [...keys].sort()) {
    const item = await ctx.web.getItem(library, key);
    const version = versionOf(item);
    if (version === null) throw new Error(`Item ${key} has no version; refusing to plan a write.`);
    const data = item?.data ?? item ?? {};
    const before = normalizeTags(data.tags);
    const { next, changed } = applyRetags(before, retags);
    if (!changed) continue;
    itemActions.push({
      item_key: key, expected_version: version, title: String(data.title ?? '(untitled)'),
      before_tags: before, after_tags: next,
    });
  }

  const now = new Date().toISOString();
  const update = updateVocabulary(vocabulary, retags, deletionPlans, libraryTags, itemActions, now);
  const planBase = {
    schema_version: '1.0',
    plan_type: 'zotero-tag-manager',
    created_at: now,
    target: { library_type: library.type, library_id: library.id },
    vocabulary_revision: vocabulary.revision,
    allow_protected: Boolean(input.allowProtected),
    protected_targets: protectedNames,
    operations: input.operations,
    retags,
    deletions: deletionPlans,
    items: itemActions,
    vocabulary_changes: {
      folded: update.folded,
      renamed: update.renamed,
      aliases_added: update.aliases_added,
      alias_skipped: update.alias_skipped,
      removed_entries: update.removed_entries,
    },
    vocabulary_after: update.vocabulary,
  };
  const planHash = tagManagerPlanHash(planBase);
  const stem = `${timestampName()}-${planHash.slice(-12)}`;
  const { planPath } = managerPaths(ctx.config.dataDir, library, stem);
  await persist(planPath, { ...planBase, plan_hash: planHash });
  return {
    status: 'planned',
    plan_hash: planHash,
    plan_path: planPath,
    vocabulary_revision: vocabulary.revision,
    vocabulary_revision_after: update.vocabulary?.revision ?? vocabulary.revision,
    item_count: itemActions.length,
    deletion_count: deletionPlans.length,
    protected_targets: protectedNames,
    vocabulary_changes: planBase.vocabulary_changes,
    items: itemActions.map((action) => ({
      item_key: action.item_key,
      expected_version: action.expected_version,
      removed: action.before_tags.filter((tag) => !action.after_tags.some((next) => next.tag === tag.tag)).map((tag) => tag.tag),
      added: action.after_tags.filter((tag) => !action.before_tags.some((previous) => previous.tag === tag.tag)).map((tag) => tag.tag),
    })),
  };
}

export async function applyTagPlan(
  ctx: ToolContext,
  library: LibraryRef,
  input: { planPath: string; mode: 'dry_run' | 'apply'; confirmPlanHash?: string },
): Promise<Record<string, unknown>> {
  const raw = JSON.parse(await readFile(input.planPath, 'utf8'));
  if (!raw || raw.schema_version !== '1.0' || raw.plan_type !== 'zotero-tag-manager') {
    throw new Error('Unsupported tag-manager plan schema or plan_type');
  }
  if (raw.target?.library_type !== library.type || raw.target?.library_id !== library.id) {
    throw new Error('Plan target does not match the selected Zotero library');
  }
  const hash = tagManagerPlanHash(raw);
  if (hash !== raw.plan_hash) throw new Error('Plan file hash does not match plan_hash; no writes were attempted.');
  if (input.mode === 'apply') {
    if (input.confirmPlanHash !== raw.plan_hash) {
      throw new Error('Apply requires confirm_plan_hash exactly matching plan_hash');
    }
    if (!ctx.web.canWrite) {
      throw new Error('Saving to Zotero needs a Zotero key, or Zotero 10 or later open on this computer. Call setup_status.');
    }
  }
  return withVocabularyLock(ctx.config.dataDir, library, async () => {
    const vocabulary = await loadVocabulary(ctx.config.dataDir, library);
    if (vocabulary.revision !== raw.vocabulary_revision) {
      throw new Error(`Semantic vocabulary revision changed: expected ${raw.vocabulary_revision}, current ${vocabulary.revision}. No writes were attempted.`);
    }
    const conflicts: string[] = [];
    for (const action of raw.items as ItemAction[]) {
      const item = await ctx.web.getItem(library, action.item_key);
      const version = versionOf(item);
      const tags = normalizeTags((item?.data ?? item)?.tags);
      if (version !== action.expected_version) {
        conflicts.push(`${action.item_key} version ${version ?? 'missing'} does not match plan version ${action.expected_version}`);
      } else if (!sameTags(tags, action.before_tags)) {
        conflicts.push(`${action.item_key} tags changed since the plan`);
      }
    }
    for (const deletion of raw.deletions as Array<{ tag: string }>) {
      const page = await ctx.router.searchItems({
        library, tag: deletion.tag, top: false, includeTrashed: false, limit: 1, start: 0,
      });
      if (page.totalResults > 0) conflicts.push(`tag "${deletion.tag}" is no longer unused (${page.totalResults} items)`);
    }
    if (conflicts.length) {
      throw new Error(`Tag manager plan is stale; no writes were attempted. ${conflicts.join('; ')}. Re-scan and plan again.`);
    }
    if (input.mode === 'dry_run') {
      return {
        status: 'dry_run', plan_hash: raw.plan_hash, plan_path: input.planPath,
        item_count: raw.items.length, deletion_count: raw.deletions.length,
        vocabulary_revision: vocabulary.revision,
        vocabulary_revision_after: raw.vocabulary_after?.revision ?? vocabulary.revision,
      };
    }
    const started = new Date().toISOString();
    const results: Array<Record<string, unknown>> = [];
    let failed = false;
    for (const action of raw.items as ItemAction[]) {
      if (sameTags(action.before_tags, action.after_tags)) {
        results.push({ item_key: action.item_key, outcome: 'unchanged', error: null });
        continue;
      }
      try {
        const version = await ctx.web.patchItem(library, action.item_key, { tags: action.after_tags }, action.expected_version);
        results.push({
          item_key: action.item_key, outcome: 'updated', zotero_version: version,
          removed: action.before_tags.filter((tag) => !action.after_tags.some((next) => next.tag === tag.tag)).map((tag) => tag.tag),
          added: action.after_tags.filter((tag) => !action.before_tags.some((previous) => previous.tag === tag.tag)).map((tag) => tag.tag),
          error: null,
        });
      } catch (error) {
        failed = true;
        results.push({
          item_key: action.item_key, outcome: 'failed',
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        });
        break;
      }
    }
    let vocabularyError: string | null = null;
    let revisionAfter = vocabulary.revision;
    if (!failed && raw.vocabulary_after) {
      try {
        await saveVocabulary(vocabularyPath(ctx.config.dataDir, library), raw.vocabulary_after);
        revisionAfter = raw.vocabulary_after.revision;
      } catch (error) {
        vocabularyError = error instanceof Error ? error.message : String(error);
      }
    }
    const summary = {
      updated: results.filter((result) => result.outcome === 'updated').length,
      unchanged: results.filter((result) => result.outcome === 'unchanged').length,
      failed: results.filter((result) => result.outcome === 'failed').length,
      deletions: failed ? 0 : raw.deletions.length,
    };
    const receipt = {
      schema_version: '1.0',
      receipt_type: 'zotero-tag-manager',
      plan_hash: raw.plan_hash,
      status: failed || vocabularyError ? 'partial' : 'complete',
      started_at: started,
      updated_at: new Date().toISOString(),
      vocabulary_revision_before: vocabulary.revision,
      vocabulary_revision_after: revisionAfter,
      vocabulary_error: vocabularyError,
      vocabulary_changes: raw.vocabulary_changes,
      deletions: failed ? [] : raw.deletions,
      results,
      summary,
    };
    const receiptPath = join(dirname(dirname(input.planPath)), 'receipts', basename(input.planPath));
    await persist(receiptPath, receipt);
    return {
      status: receipt.status, plan_hash: raw.plan_hash, plan_path: input.planPath, receipt_path: receiptPath,
      vocabulary_revision: revisionAfter, vocabulary_error: vocabularyError, summary,
    };
  });
}
