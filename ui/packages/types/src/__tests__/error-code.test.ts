import { describe, it, expect } from 'vitest';
import { errorCodeIs, errorCodeIsAnyOf } from '../error-code';

describe('errorCodeIs', () => {
  it('matches the catalog spelling', () => {
    expect(errorCodeIs({ code: 'DESTRUCTIVE_CHANGE' }, 'DESTRUCTIVE_CHANGE')).toBe(true);
  });

  // The reason this helper exists: a console build outlives the server rename,
  // and the pre-ADR-0112 server is still a supported peer.
  it('matches a pre-ADR-0112 server still sending the lowercase spelling', () => {
    expect(errorCodeIs({ code: 'destructive_change' }, 'DESTRUCTIVE_CHANGE')).toBe(true);
  });

  it('does not match a different code', () => {
    expect(errorCodeIs({ code: 'INVALID_METADATA' }, 'DESTRUCTIVE_CHANGE')).toBe(false);
    expect(errorCodeIs({ code: 'invalid_metadata' }, 'DESTRUCTIVE_CHANGE')).toBe(false);
  });

  it('tolerates anything as the error', () => {
    for (const junk of [null, undefined, {}, 'DESTRUCTIVE_CHANGE', 42, { code: '' }, { code: 7 }]) {
      expect(errorCodeIs(junk, 'DESTRUCTIVE_CHANGE')).toBe(false);
    }
  });

  it('errorCodeIsAnyOf matches on any listed code, in either spelling', () => {
    const codes = ['INVALID_METADATA', 'INVALID_PAYLOAD'] as const;
    expect(errorCodeIsAnyOf({ code: 'invalid_payload' }, codes)).toBe(true);
    expect(errorCodeIsAnyOf({ code: 'INVALID_METADATA' }, codes)).toBe(true);
    expect(errorCodeIsAnyOf({ code: 'ITEM_LOCKED' }, codes)).toBe(false);
    expect(errorCodeIsAnyOf(null, codes)).toBe(false);
  });
});
