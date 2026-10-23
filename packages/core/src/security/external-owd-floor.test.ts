// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [Ruling of record 6355206139, letter B] The EXTERNAL rung's OWD seam
// vocabulary: who is external, how the grant stamp reads, and the floor.

import { describe, it, expect } from 'vitest';
import {
  EXTERNAL_READ_GRANT_KEY,
  EXTERNAL_WRITE_GRANT_KEY,
  externalGrantSpeaks,
  isExternalAudienceContext,
  owdForAudience,
} from './external-owd-floor.js';
import { OPERATION_PRIVATE_KEY_PREFIX } from './operation-private-keys.js';

const external = { userId: 'u_ext', audience: 'external', posture: 'EXTERNAL' };

describe('who is external', () => {
  it('either carried value says so; neither, or a guest, does not', () => {
    expect(isExternalAudienceContext({ audience: 'external' })).toBe(true);
    expect(isExternalAudienceContext({ posture: 'EXTERNAL' })).toBe(true);
    expect(isExternalAudienceContext({ audience: 'internal', posture: 'MEMBER' })).toBe(false);
    expect(isExternalAudienceContext({ principalKind: 'guest' })).toBe(false);
    expect(isExternalAudienceContext(undefined)).toBe(false);
    expect(isExternalAudienceContext(null)).toBe(false);
  });
});

describe('the grant stamp', () => {
  it('is operation-private: both keys carry the `__` prefix, so a forwarded envelope drops them', () => {
    expect(EXTERNAL_READ_GRANT_KEY.startsWith(OPERATION_PRIVATE_KEY_PREFIX)).toBe(true);
    expect(EXTERNAL_WRITE_GRANT_KEY.startsWith(OPERATION_PRIVATE_KEY_PREFIX)).toBe(true);
  });

  it('speaks for the object it names, and the class it was stamped for, only', () => {
    const ctx = { ...external, [EXTERNAL_READ_GRANT_KEY]: 'po' };
    expect(externalGrantSpeaks(ctx, 'po', 'read')).toBe(true);
    expect(externalGrantSpeaks(ctx, 'invoice', 'read')).toBe(false);
    expect(externalGrantSpeaks(ctx, 'po', 'write')).toBe(false);
    expect(externalGrantSpeaks({ ...external, [EXTERNAL_READ_GRANT_KEY]: true }, 'po', 'read')).toBe(false);
  });
});

describe('the OWD an operation meets', () => {
  it('an external meets owner_only on every model, with no grant speaking', () => {
    for (const model of ['read', 'public', 'private'] as const) {
      expect(owdForAudience(model, external, 'po', 'read')).toBe('private');
      expect(owdForAudience(model, external, 'po', 'write')).toBe('private');
    }
  });

  it('a held grant’s RLS lifts the floor for its object and class: the object’s own model stands', () => {
    const ctx = { ...external, [EXTERNAL_READ_GRANT_KEY]: 'po', [EXTERNAL_WRITE_GRANT_KEY]: 'po' };
    expect(owdForAudience('public', ctx, 'po', 'read')).toBe('public');
    expect(owdForAudience('read', ctx, 'po', 'write')).toBe('read');
    expect(owdForAudience('public', ctx, 'invoice', 'read')).toBe('private');
  });

  it('CONTROL: an internal principal meets the object’s own model, stamp or no stamp', () => {
    expect(owdForAudience('public', { userId: 'u1', posture: 'MEMBER' }, 'po', 'read')).toBe('public');
    expect(owdForAudience('read', { userId: 'u1' }, 'po', 'write')).toBe('read');
  });
});
