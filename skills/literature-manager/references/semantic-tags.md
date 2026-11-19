# Agent Semantic Tags Workflow

Use this workflow when Frank asks to generate, refresh, display, or clean Agent
Tags for imported papers, selected Zotero items, or a collection.

## Data ownership

- Final tags are native Zotero tags named `AI4S:Semantic:<canonical English>`.
- Re-analysis may replace only `AI4S:Semantic:*` on processed items.
- Ordinary tagging removes Zotero automatic tags (`type: 1`) only from the
  same processed items.
- Preserve user-created tags and all `AI4S:ArticleType:*`,
  `AI4S:Priority:*`, `JCR:*`, and `CAS:*` tags.
- Collection/library cleanup outside the tagging batch requires an explicit
  `zotero_cleanup_auto_tags` request.

## Existing Zotero items or collection

1. Call `zotero_semantic_tag_context` with either item keys or one collection
   key. Page collections in batches of at most 50.
2. Use title plus abstract by default. For `metadata-only`, propose no more
   than two tags and no mechanism tag.
3. Reuse the returned vocabulary entry whenever its canonical label or alias
   accurately represents the concept. Use `decision: reuse` and its vocabulary
   ID or alias.
4. Use `decision: new` only for a genuinely absent reusable concept. Supply a
   concise English canonical label, dimension, definition, and real aliases if
   any. A narrow entity is eligible only when it is a principal study subject.
5. Assign zero to four tags. Do not fill absent dimensions. Returning zero is
   preferable to a vague label.
6. Call `zotero_apply_semantic_tags` with the exact context vocabulary revision
   and item versions. This automatically applies the restricted change and
   saves a hashed plan and receipt; no second confirmation is required because
   Frank enabled automatic Agent tagging.
7. If the vocabulary or item version changed, re-read context. Never bypass a
   revision conflict.

## Newly imported evidence

When `semantic_tag_candidates.json` exists from `literature-research`:

1. Apply the reviewed import plan first and read the import receipt.
2. Map stable evidence IDs in the candidate artifact to resulting Zotero item
   keys from the receipt.
3. Call `zotero_semantic_tag_context` for those item keys to get current item
   versions and vocabulary revision.
4. Reconcile each candidate with the current vocabulary. Candidate canonical
   text is not authority to create a duplicate; an accurate alias match must be
   reused.
5. Call `zotero_apply_semantic_tags`. Preserve the semantic receipt beside the
   import receipt in the run handoff.

Do not insert semantic candidates into the import plan before vocabulary
reconciliation. The library vocabulary, not a single research run, owns the
canonical terminology.

## Vocabulary portability

- `zotero_semantic_tag_vocabulary` with `inspect` reports current revision and
  entries.
- `export` writes a portable JSON snapshot in the MCP data directory unless an
  explicit path is supplied.
- `import` is merge-only, requires the expected current revision, and stops on
  canonical, alias, or dimension conflicts.
- Local vocabulary JSON is user data and must not be committed to this
  repository.

## Tag manager

Use `zotero_tag_manager` when Frank asks to find duplicate tags, merge or rename
them, or delete tags that nothing uses. Keep the existing tools in their lanes:

- `zotero_list_tags` lists names, usage, and the automatic flag. It does not
  cluster duplicates.
- `zotero_manage_tags` adds or removes named tags on named items. It does not
  update the semantic vocabulary and has no plan or receipt.
- `zotero_tag_audit` checks an external tier vocabulary. It does not find
  near-duplicates.
- `zotero_cleanup_auto_tags` removes only Zotero automatic tags (`type: 1`).
- `zotero_semantic_tag_vocabulary` inspects, exports, or merge-imports the JSON
  vocabulary. It does not edit item tags.

`scan` reports clusters with usage counts. A cluster is a confident match:
case, NFKC, dash, or whitespace (the same fold as `comparisonKey`); punctuation
(`single-cell` / `single cell`); singular/plural; a bare label versus
`AI4S:Semantic:<label>`; or a library tag that matches a vocabulary alias
(abbreviation versus full name). Set `include_near` only when Frank wants
token-overlap suggestions. Those suggestions are for you to judge. Do not merge
a near match unless Frank agrees that the two labels are the same concept.
`needs_judgment` and `dimension_conflict` clusters also wait for that decision.

`unused` lists library tags whose item count is zero and vocabulary entries
whose canonical tag and aliases are on nothing. A zero-item tag has no item to
edit. Deleting an unused `AI4S:Semantic:<canonical>` tag also removes that
vocabulary entry when no alias is still on an item.

Writes use the plan, then confirm, then apply:

1. Call `scan` or `unused` and read `vocabulary_revision`.
2. Call `plan` with exact tag strings, that revision, and one hop per tag
   (`merge` names `loser` and `winner`; `rename` names `from` and `to`;
   `delete_unused` names `tags`). This writes a hashed plan and does not change
   Zotero.
3. Call `apply` with `mode: dry_run` and the plan path. A stale item version or
   vocabulary revision stops the dry run before any write.
4. After Frank confirms that exact `plan_hash`, call `apply` with
   `mode: apply` and `confirm_plan_hash`. The receipt records each item and the
   vocabulary revision.

A merge or rename removes only the named loser and adds the winner, leaving
every other tag on the item. When the loser is a vocabulary entry, its
canonical and aliases are folded into the winner's aliases and the loser entry
is removed. A rename of a canonical keeps the old label as an alias. The
destination of a vocabulary entry must be `AI4S:Semantic:<canonical English>`
or an existing vocabulary label. Non-English loser text is not stored as an
alias; the plan lists it under `alias_skipped` and the item tag is still
retagged because the operation named it.

`AI4S:Priority:1`, `AI4S:Priority:2`, `AI4S:Priority:3`, `AI4S:ArticleType:*`,
`JCR:*`, and `CAS:*` are refused unless the operation names those exact tags
and `allow_protected` is true. Do not set that flag unless Frank explicitly
asked to change those tags. Other user tags are never removed unless the
operation names them.

If apply reports a conflict or a partial receipt, re-scan. Do not retry the
old plan hash. Trashed items are left alone.

## Failure handling

- Missing abstract: use metadata-only restrictions.
- No defensible label: apply an empty semantic set with `no-confident-tag`.
- More than four proposals or a metadata-only mechanism: correct the
  recommendation; never rely on silent truncation.
- Read-only/non-bibliographic item: accept the reported skip.
- Partial receipt: retry only failed/conflicted items after fresh context.
- Damaged vocabulary: stop writes and surface the path; never recreate an
  empty vocabulary over it.
