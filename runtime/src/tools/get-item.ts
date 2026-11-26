import { z } from 'zod';
import type { ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';
import { creatorSummary } from './search-items.js';

// The default projection for one item: the fields a decision about the item
// needs. The full record — every bibliographic field, version, tags,
// collections, relations — is opt-in via response_format: "detailed", because
// a whole item was the largest single read result the workbench still
// produced after zotero_search_items went concise by default.
function projectItem(item: any): Record<string, unknown> {
  const d = item.data ?? item;
  return {
    key: item.key ?? d.key,
    itemType: d.itemType,
    title: d.title ?? d.caseName ?? d.subject ?? '(untitled)',
    creatorSummary: creatorSummary(d.creators),
    date: d.date,
    DOI: d.DOI,
  };
}

// Child notes and attachments get the same treatment: key, type, and a short
// title. The full child objects come back only with response_format: "detailed".
function projectChild(child: any): Record<string, unknown> {
  const d = child.data ?? child;
  const title =
    (typeof d.title === 'string' && d.title.trim() && d.title) ||
    (typeof d.filename === 'string' && d.filename.trim() && d.filename) ||
    (typeof d.name === 'string' && d.name.trim() && d.name) ||
    (typeof d.note === 'string' && d.note.trim() && `${d.note.replace(/\s+/g, ' ').trim().slice(0, 80)}`) ||
    '(no title)';
  return {
    key: child.key ?? d.key,
    itemType: d.itemType,
    title,
  };
}

const CONCISE_NOTE =
  'Concise projection. Set response_format: "detailed" for the full record (all fields, version, tags, collections) — the version is required before you update or delete this item.';

const getItem: ToolDefinition = {
  name: 'zotero_get_item',
  title: 'Get a Zotero item',
  description:
    'Fetch one item by its key. The default `response_format: "concise"` returns a high-signal projection (key, itemType, title, creatorSummary, date, DOI); set `response_format: "detailed"` for the full record — every field plus version, tags, collections, relations. Use detailed before chaining a write: the returned `version` is required to update or delete this item, and `collections`/`tags` are needed to plan moves. Optionally set `include_children` to also return the item\'s child notes and attachments (concise children carry only key, itemType, and a short title). Use `include` to additionally request rendered output: "bib" (formatted bibliography entry), "citation" (inline citation), or "csljson" (CSL-JSON for downstream formatting); combine with `style` (a CSL style id, default chicago-note-bibliography) and `locale`. Returns source and libraryVersion either way.',
  inputSchema: {
    item_key: z.string().describe('The 8-character Zotero item key.'),
    response_format: z
      .enum(['concise', 'detailed'])
      .optional()
      .describe('Detail level of the returned item (default "concise").'),
    include_children: z.boolean().optional().describe('Also fetch child notes/attachments.'),
    include: z
      .string()
      .optional()
      .describe('Extra rendered content: "bib", "citation", or "csljson".'),
    style: z
      .string()
      .optional()
      .describe('CSL style id for bib/citation (default chicago-note-bibliography).'),
    locale: z
      .string()
      .optional()
      .describe('Locale for bib/citation, e.g. en-US.'),
    library_type: z.enum(['user', 'group']).optional(),
    library_id: z.number().int().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const detailed = args.response_format === 'detailed';
    const library = args.library_id
      ? { type: (args.library_type ?? 'group') as 'user' | 'group', id: args.library_id }
      : undefined;
    const result = await ctx.router.getItemWithMetadata(args.item_key, {
      include: args.include,
      library,
    });
    const item = result.data;
    const structured: Record<string, unknown> = {
      item: detailed ? item : projectItem(item),
      source: result.source,
      libraryVersion: result.lastModifiedVersion,
    };
    let summary = `Item ${args.item_key}: ${item?.data?.title ?? item?.title ?? '(no title)'}`;
    if (args.include_children) {
      const children = await ctx.router.getItemChildren(args.item_key, { library });
      structured.children = detailed ? children.data : children.data.map(projectChild);
      structured.childrenSource = children.source;
      structured.childrenLibraryVersion = children.lastModifiedVersion;
      summary += ` (+${children.data.length} child item(s))`;
    }
    if (!detailed) {
      structured.format = 'concise';
      structured.note = CONCISE_NOTE;
      summary += ' Concise projection; use response_format: "detailed" for the full record.';
    }
    return ok(structured, summary);
  },
};

export default getItem;
