import { describe, it, expect } from 'vitest';
import { hasExtractedFulltext, liveTestsEnabled } from './live-gate.js';

describe('live e2e gate', () => {
  it('stays off unless AI4S_LIVE_TESTS=1, even when a Zotero key is present', () => {
    expect(liveTestsEnabled({ ZOTERO_API_KEY: 'present' } as NodeJS.ProcessEnv)).toBe(false);
    expect(liveTestsEnabled({ AI4S_LIVE_TESTS: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(liveTestsEnabled({ ZOTERO_API_KEY: 'present', AI4S_LIVE_TESTS: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(liveTestsEnabled({ ZOTERO_API_KEY: 'present', AI4S_LIVE_TESTS: 'true' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('treats a missing or empty fulltext result as nothing to assert', () => {
    expect(hasExtractedFulltext(undefined)).toBe(false);
    expect(hasExtractedFulltext({ isError: true, structuredContent: { passages: [{ charStart: 0 }] } })).toBe(false);
    expect(hasExtractedFulltext({ structuredContent: { passages: [] } })).toBe(false);
    expect(hasExtractedFulltext({ structuredContent: { passages: [{ charStart: 0 }] } })).toBe(true);
  });
});
