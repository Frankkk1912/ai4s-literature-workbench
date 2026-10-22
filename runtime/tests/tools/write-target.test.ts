import { describe, expect, it } from 'vitest';
import { requireCloudLibrary } from '../../src/registry/registry.js';

const ctx = (cloud: unknown, canWrite: boolean) => ({ capabilities: { cloud }, web: { canWrite } }) as never;

describe('where a save goes', () => {
  it('goes to the key\'s library when there is a key', () => {
    expect(requireCloudLibrary(ctx({ userID: 42 }, true))).toEqual({ type: 'user', id: 42 });
  });

  it('goes to the desktop library when there is no key but saving through Zotero 10 is on', () => {
    expect(requireCloudLibrary(ctx(null, true))).toEqual({ type: 'user', id: 0 });
  });

  it('an explicit group is left alone', () => {
    expect(requireCloudLibrary(ctx(null, false), { library_type: 'group', library_id: 9 })).toEqual({ type: 'group', id: 9 });
  });

  it('with neither, says what would make saving work, in plain words', () => {
    expect(() => requireCloudLibrary(ctx(null, false))).toThrow(/Zotero key.*setup_status.*Zotero 10 or later/s);
  });
});
