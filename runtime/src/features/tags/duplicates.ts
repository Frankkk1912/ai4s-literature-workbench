import {
  SEMANTIC_TAG_PREFIX,
  comparisonKey,
  semanticLabel,
  semanticTag,
  type SemanticVocabulary,
} from '../semantic-tags/contract.js';

/**
 * Match kinds, strongest first:
 * - case: comparisonKey already treats these as the same string (case, NFKC, dashes, whitespace)
 * - label: the same concept with and without the AI4S:Semantic: prefix
 * - punctuation: comparisonKey still differs, but letters and digits match ("single-cell" / "single cell")
 * - plural: a light English singular fold ("Macrophage" / "Macrophages")
 * - alias: a library tag matches a vocabulary alias of another label (abbreviation vs full name)
 * Near matches are token overlap only. They are suggestions for the agent, not merge candidates.
 */
export const MATCH_KINDS = ['case', 'label', 'punctuation', 'plural', 'alias'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export interface LibraryTag {
  name: string;
  numItems?: number;
  auto: boolean;
}

export interface DuplicateMember {
  name: string;
  num_items: number | null;
  auto: boolean;
  protected: boolean;
  in_library: boolean;
  vocabulary_id?: string;
  vocabulary_role?: 'canonical' | 'alias';
}

export interface DuplicateCluster {
  reasons: MatchKind[];
  suggested_winner: string | null;
  needs_judgment: boolean;
  protected: boolean;
  mixed_protected: boolean;
  dimension_conflict: boolean;
  library_use_count: number;
  members: DuplicateMember[];
  vocabulary_entries: Array<{
    id: string;
    canonical: string;
    dimension: string;
    aliases: string[];
    usage_count: number;
  }>;
}

export interface NearMatch {
  left: { name: string; num_items: number | null };
  right: { name: string; num_items: number | null };
  score: number;
  shared_tokens: string[];
  needs_judgment: true;
}

export interface DuplicateScan {
  clusters: DuplicateCluster[];
  omitted_clusters: number;
  near_matches: NearMatch[];
  near_omitted: number;
}

const IRREGULAR_PLURALS: Record<string, string> = {
  analyses: 'analysis',
  hypotheses: 'hypothesis',
  theses: 'thesis',
  crises: 'crisis',
  indices: 'index',
  matrices: 'matrix',
  vertices: 'vertex',
  appendices: 'appendix',
};

const STOPWORDS = new Set(['the', 'and', 'of', 'for', 'with', 'from', 'into', 'via', 'using', 'based', 'per']);

export function conceptLabel(name: string): string {
  return semanticLabel(name) ?? name;
}

export function isProtectedTag(name: string): boolean {
  const text = name.normalize('NFKC').trim();
  return /^AI4S:Priority:[1-3]$/i.test(text)
    || /^AI4S:ArticleType:/i.test(text)
    || /^JCR:/i.test(text)
    || /^CAS:/i.test(text);
}

export function punctuationKey(value: string): string {
  return comparisonKey(conceptLabel(value)).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function singularize(token: string): string {
  if (IRREGULAR_PLURALS[token]) return IRREGULAR_PLURALS[token];
  if (token.length < 4 || /^\d+$/.test(token)) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (/(?:s|x|z|ch|sh)es$/.test(token) && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us') && !token.endsWith('is')) {
    return token.slice(0, -1);
  }
  return token;
}

export function pluralKey(value: string): string {
  return punctuationKey(value).split(' ').filter(Boolean).map(singularize).join(' ');
}

/** Structural near-sameness. `null` when the strings are identical or share no fold. */
export function structuralKind(left: string, right: string): Exclude<MatchKind, 'alias'> | null {
  if (left === right) return null;
  if (comparisonKey(left) === comparisonKey(right)) return 'case';
  if (comparisonKey(conceptLabel(left)) === comparisonKey(conceptLabel(right))) return 'label';
  const punctuation = punctuationKey(left);
  if (punctuation && punctuation === punctuationKey(right)) return 'punctuation';
  const plural = pluralKey(left);
  if (plural && plural === pluralKey(right)) return 'plural';
  return null;
}

function contentTokens(value: string): Set<string> {
  return new Set(
    pluralKey(value).split(' ').filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

interface Surface {
  id: string;
  name: string;
}

function pushGroup(groups: Map<string, Surface[]>, key: string, surface: Surface): void {
  if (key.length < 2) return;
  const list = groups.get(key);
  if (list) list.push(surface);
  else groups.set(key, [surface]);
}

function linkGroup(
  groups: Map<string, Surface[]>,
  add: (left: string, right: string, kind: MatchKind) => void,
  accept: (kind: MatchKind) => boolean,
): void {
  for (const surfaces of groups.values()) {
    const unique: Surface[] = [];
    const seen = new Set<string>();
    for (const surface of surfaces) {
      if (seen.has(surface.id)) continue;
      seen.add(surface.id);
      unique.push(surface);
    }
    if (unique.length < 2) continue;
    const first = unique[0]!;
    for (const surface of unique.slice(1)) {
      const kind = structuralKind(first.name, surface.name);
      // Stronger folds are linked from their own groups, so a case pair is not also recorded as punctuation.
      if (kind && accept(kind)) add(first.id, surface.id, kind);
    }
  }
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    this.add(id);
    const parent = this.parent.get(id)!;
    if (parent !== id) this.parent.set(id, this.find(parent));
    return this.parent.get(id)!;
  }

  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.parent.set(a, b);
  }
}

function libraryCount(tags: LibraryTag[], name: string): number | undefined {
  return tags.find((tag) => tag.name === name)?.numItems;
}

/** A vocabulary entry is unused when none of its semantic tag, canonical, or aliases is on an item. */
export function vocabularyEntryUnused(entry: SemanticVocabulary['tags'][number], libraryTags: LibraryTag[]): boolean {
  const labels = [semanticTag(entry.canonical), entry.canonical, ...entry.aliases];
  return labels.every((label) => {
    const exact = libraryTags.find((tag) => tag.name === label);
    if (!exact) return true;
    return exact.numItems === 0;
  });
}

export function findDuplicateClusters(
  libraryTags: LibraryTag[],
  vocabulary: SemanticVocabulary,
  options: { includeNear?: boolean; limit?: number } = {},
): DuplicateScan {
  const limit = options.limit ?? 50;
  const edges = new Map<string, Set<MatchKind>>();
  const add = (left: string, right: string, kind: MatchKind) => {
    if (left === right) return;
    const key = left < right ? `${left}\0${right}` : `${right}\0${left}`;
    const kinds = edges.get(key) ?? new Set<MatchKind>();
    kinds.add(kind);
    edges.set(key, kinds);
  };

  const comparisonGroups = new Map<string, Surface[]>();
  const punctuationGroups = new Map<string, Surface[]>();
  const pluralGroups = new Map<string, Surface[]>();
  const roleByLibrary = new Map<string, { id: string; role: 'canonical' | 'alias' }>();

  for (const tag of libraryTags) {
    const surface = { id: `lib:${tag.name}`, name: tag.name };
    pushGroup(comparisonGroups, comparisonKey(tag.name), surface);
    pushGroup(punctuationGroups, punctuationKey(tag.name), surface);
    pushGroup(pluralGroups, pluralKey(tag.name), surface);
  }
  for (const entry of vocabulary.tags) {
    const canonicalSurface = { id: `vocab:${entry.id}`, name: semanticTag(entry.canonical) };
    pushGroup(punctuationGroups, punctuationKey(entry.canonical), canonicalSurface);
    pushGroup(pluralGroups, pluralKey(entry.canonical), canonicalSurface);
    for (const alias of entry.aliases) {
      const aliasSurface = { id: `vocab:${entry.id}`, name: alias };
      pushGroup(punctuationGroups, punctuationKey(alias), aliasSurface);
      pushGroup(pluralGroups, pluralKey(alias), aliasSurface);
    }
  }
  linkGroup(comparisonGroups, add, (kind) => kind === 'case');
  // Label pairs share a punctuation key (the prefix is not part of the concept) but structuralKind reports label first.
  linkGroup(punctuationGroups, add, (kind) => kind === 'punctuation' || kind === 'label');
  linkGroup(pluralGroups, add, (kind) => kind === 'plural');

  for (const tag of libraryTags) {
    for (const entry of vocabulary.tags) {
      const libId = `lib:${tag.name}`;
      const vocabId = `vocab:${entry.id}`;
      const canonicalKey = comparisonKey(entry.canonical);
      const labelKey = comparisonKey(conceptLabel(tag.name));
      if (tag.name === semanticTag(entry.canonical)) {
        roleByLibrary.set(libId, { id: entry.id, role: 'canonical' });
        continue;
      }
      if (labelKey === canonicalKey || comparisonKey(tag.name) === canonicalKey) {
        const kind = structuralKind(tag.name, semanticTag(entry.canonical));
        if (kind) add(libId, vocabId, kind);
        roleByLibrary.set(libId, { id: entry.id, role: 'canonical' });
        continue;
      }
      const alias = entry.aliases.find((candidate) =>
        comparisonKey(candidate) === labelKey || comparisonKey(candidate) === comparisonKey(tag.name));
      if (alias) {
        add(libId, vocabId, 'alias');
        if (!roleByLibrary.has(libId)) roleByLibrary.set(libId, { id: entry.id, role: 'alias' });
      }
    }
  }
  for (let i = 0; i < vocabulary.tags.length; i += 1) {
    for (let j = i + 1; j < vocabulary.tags.length; j += 1) {
      const left = vocabulary.tags[i]!;
      const right = vocabulary.tags[j]!;
      let kind: MatchKind | null = null;
      if (comparisonKey(left.canonical) === comparisonKey(right.canonical)) kind = 'label';
      const pairs = [
        [left.canonical, right.canonical],
        ...left.aliases.map((alias) => [alias, right.canonical]),
        ...right.aliases.map((alias) => [left.canonical, alias]),
      ];
      for (const [a, b] of pairs) {
        const structural = structuralKind(a!, b!);
        if (!structural) continue;
        if (!kind || MATCH_KINDS.indexOf(structural) < MATCH_KINDS.indexOf(kind)) kind = structural;
      }
      if (kind) add(`vocab:${left.id}`, `vocab:${right.id}`, kind);
    }
  }

  const unions = new UnionFind();
  const kindsByRoot = new Map<string, Set<MatchKind>>();
  const nodesByRoot = new Map<string, Set<string>>();
  for (const [pair, kinds] of edges) {
    const [left, right] = pair.split('\0');
    unions.union(left!, right!);
    const root = unions.find(left!);
    const bucket = kindsByRoot.get(root) ?? new Set<MatchKind>();
    for (const kind of kinds) bucket.add(kind);
    kindsByRoot.set(root, bucket);
    const nodes = nodesByRoot.get(root) ?? new Set<string>();
    nodes.add(left!);
    nodes.add(right!);
    nodesByRoot.set(root, nodes);
  }
  // Re-home buckets after unions compress.
  const grouped = new Map<string, { nodes: Set<string>; kinds: Set<MatchKind> }>();
  for (const [root, nodes] of nodesByRoot) {
    const canonicalRoot = unions.find(root);
    const group = grouped.get(canonicalRoot) ?? { nodes: new Set<string>(), kinds: new Set<MatchKind>() };
    for (const node of nodes) group.nodes.add(node);
    for (const kind of kindsByRoot.get(root) ?? []) group.kinds.add(kind);
    grouped.set(canonicalRoot, group);
  }

  const entryById = new Map(vocabulary.tags.map((entry) => [entry.id, entry]));
  const clusters: DuplicateCluster[] = [];
  for (const group of grouped.values()) {
    const members: DuplicateMember[] = [];
    const entryIds = new Set<string>();
    for (const node of group.nodes) {
      if (node.startsWith('lib:')) {
        const name = node.slice(4);
        const tag = libraryTags.find((candidate) => candidate.name === name);
        const role = roleByLibrary.get(node);
        if (role) entryIds.add(role.id);
        members.push({
          name,
          num_items: tag?.numItems ?? null,
          auto: Boolean(tag?.auto),
          protected: isProtectedTag(name),
          in_library: true,
          ...(role ? { vocabulary_id: role.id, vocabulary_role: role.role } : {}),
        });
      } else if (node.startsWith('vocab:')) {
        const entry = entryById.get(node.slice(6));
        if (entry) entryIds.add(entry.id);
      }
    }
    for (const id of entryIds) {
      const entry = entryById.get(id);
      if (!entry) continue;
      const name = semanticTag(entry.canonical);
      const existing = members.find((member) => member.name === name);
      const count = libraryCount(libraryTags, name);
      if (existing) {
        existing.vocabulary_id = entry.id;
        existing.vocabulary_role = 'canonical';
      } else {
        const libraryTag = libraryTags.find((tag) => tag.name === name);
        members.push({
          name,
          num_items: count ?? null,
          auto: Boolean(libraryTag?.auto),
          protected: false,
          in_library: Boolean(libraryTag),
          vocabulary_id: entry.id,
          vocabulary_role: 'canonical',
        });
      }
    }
    const names = new Set(members.map((member) => member.name));
    if (names.size < 2) continue;
    members.sort((left, right) => left.name.localeCompare(right.name, 'en') || Number(right.in_library) - Number(left.in_library));
    const entries = [...entryIds].map((id) => entryById.get(id)!).filter(Boolean);
    const dimensions = new Set(entries.map((entry) => entry.dimension));
    const protectedMembers = members.filter((member) => member.protected);
    const mixed = protectedMembers.length > 0 && protectedMembers.length < members.length;
    const reasons = MATCH_KINDS.filter((kind) => group.kinds.has(kind));
    clusters.push({
      reasons,
      suggested_winner: mixed ? null : suggestWinner(members, entries),
      needs_judgment: mixed || dimensions.size > 1,
      protected: protectedMembers.length === members.length && protectedMembers.length > 0,
      mixed_protected: mixed,
      dimension_conflict: dimensions.size > 1,
      library_use_count: members.reduce((sum, member) => sum + (member.in_library ? member.num_items ?? 0 : 0), 0),
      members,
      vocabulary_entries: entries
        .map((entry) => ({
          id: entry.id, canonical: entry.canonical, dimension: entry.dimension,
          aliases: entry.aliases, usage_count: entry.usage_count,
        }))
        .sort((left, right) => left.canonical.localeCompare(right.canonical, 'en')),
    });
  }
  clusters.sort((left, right) =>
    (left.suggested_winner ?? left.members[0]?.name ?? '').localeCompare(right.suggested_winner ?? right.members[0]?.name ?? '', 'en'));

  const near = options.includeNear ? nearMatches(libraryTags, vocabulary, clusters) : [];
  return {
    clusters: clusters.slice(0, limit),
    omitted_clusters: Math.max(0, clusters.length - limit),
    near_matches: near.slice(0, 25),
    near_omitted: Math.max(0, near.length - 25),
  };
}

function suggestWinner(
  members: DuplicateMember[],
  entries: SemanticVocabulary['tags'],
): string {
  if (entries.length) {
    const ranked = [...entries].sort((left, right) =>
      right.usage_count - left.usage_count || left.canonical.localeCompare(right.canonical, 'en'));
    return semanticTag(ranked[0]!.canonical);
  }
  const ranked = [...members].sort((left, right) =>
    (right.num_items ?? -1) - (left.num_items ?? -1)
    || Number(left.auto) - Number(right.auto)
    || left.name.length - right.name.length
    || left.name.localeCompare(right.name, 'en'));
  return ranked[0]!.name;
}

function nearMatches(
  libraryTags: LibraryTag[],
  vocabulary: SemanticVocabulary,
  clusters: DuplicateCluster[],
): NearMatch[] {
  const clustered = new Map<string, number>();
  clusters.forEach((cluster, index) => {
    for (const member of cluster.members) clustered.set(member.name, index);
  });
  const surfaces = new Map<string, { name: string; num_items: number | null; tokens: Set<string> }>();
  const addSurface = (name: string, numItems: number | undefined) => {
    if (isProtectedTag(name) || name.startsWith(SEMANTIC_TAG_PREFIX) && isProtectedTag(conceptLabel(name))) return;
    if (surfaces.has(name)) return;
    const tokens = contentTokens(name);
    if (tokens.size === 0) return;
    surfaces.set(name, { name, num_items: numItems ?? null, tokens });
  };
  const ranked = [...libraryTags].sort((left, right) => (right.numItems ?? 0) - (left.numItems ?? 0)).slice(0, 800);
  for (const tag of ranked) addSurface(tag.name, tag.numItems);
  for (const entry of vocabulary.tags) {
    const name = semanticTag(entry.canonical);
    addSurface(name, libraryCount(libraryTags, name));
  }
  const list = [...surfaces.values()];
  const matches: NearMatch[] = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const left = list[i]!;
      const right = list[j]!;
      if (clustered.get(left.name) !== undefined && clustered.get(left.name) === clustered.get(right.name)) continue;
      const shared = [...left.tokens].filter((token) => right.tokens.has(token)).sort();
      if (!shared.some((token) => token.length >= 4)) continue;
      const union = left.tokens.size + right.tokens.size - shared.length;
      const score = union ? shared.length / union : 0;
      if (score < 0.5) continue;
      const [first, second] = left.name.localeCompare(right.name, 'en') <= 0 ? [left, right] : [right, left];
      matches.push({
        left: { name: first.name, num_items: first.num_items },
        right: { name: second.name, num_items: second.num_items },
        score: Number(score.toFixed(2)),
        shared_tokens: shared,
        needs_judgment: true,
      });
    }
  }
  matches.sort((left, right) =>
    right.score - left.score || left.left.name.localeCompare(right.left.name, 'en') || left.right.name.localeCompare(right.right.name, 'en'));
  return matches;
}
