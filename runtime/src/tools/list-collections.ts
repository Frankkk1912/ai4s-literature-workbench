import { z } from 'zod';
import type { ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';

const listCollections: ToolDefinition = {
  name: 'zotero_list_collections',
  title: 'List Zotero collections (read-only)',
  description:
    'List collections in a Zotero library (key, name, parent collection key, item count). Read-only — available even in read-only mode (unlike zotero_manage_collections, which also writes). Use the keys to scope zotero_search_items (collectionKey) or zotero_tag_audit (scope.collection_keys). numItems can lag behind writes or sync: count items with zotero_search_items totalResults, not numItems alone when judging duplicates. Returns source and libraryVersion.',
  inputSchema: {
    top: z.boolean().optional().describe('Only top-level collections.'),
    library_type: z.enum(['user', 'group']).optional(),
    library_id: z.number().int().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const library = args.library_id
      ? { type: (args.library_type ?? 'group') as 'user' | 'group', id: args.library_id }
      : undefined;
    const r = await ctx.router.listCollections({ top: args.top, library });
    const collections = r.data.map((c: any) => ({
      key: c.key ?? c.data?.key,
      name: c.data?.name,
      parentCollection: c.data?.parentCollection ?? false,
      numItems: c.meta?.numItems,
    }));
    const warning =
      'numItems may lag behind writes or sync. Count items with zotero_search_items totalResults; do not use numItems alone to judge duplicates.';
    return ok(
      { collections, source: r.source, libraryVersion: r.lastModifiedVersion, warning },
      `${collections.length} collection(s). ${warning}`,
    );
  },
};

export default listCollections;
