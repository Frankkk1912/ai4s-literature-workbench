/**
 * Live Zotero calls are opt-in. A key left in the environment must not make
 * `npm test` talk to a real library; set AI4S_LIVE_TESTS=1 as well.
 */
export function liveTestsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI4S_LIVE_TESTS === '1' && Boolean(env.ZOTERO_API_KEY);
}

/** A get_fulltext result that actually contains passages. Anything else is "no fulltext item". */
export function hasExtractedFulltext(result: { isError?: boolean; structuredContent?: { passages?: unknown[] } } | undefined): boolean {
  return Boolean(result && !result.isError && result.structuredContent?.passages?.length);
}
