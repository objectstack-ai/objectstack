// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { ISecurityService } from './security-service';

/**
 * These tests pin the two things a consumer of the `security` service reasons
 * about and that a refactor could silently change: the SHAPE of the surface
 * (compile-time) and the MEANING of each "empty" answer (runtime). The second
 * matters more than it looks — `undefined` and `[]` from getReadableFields are
 * opposite instructions, and a consumer that conflates them either leaks a
 * column set or blanks one out.
 */

/** Minimal stub implementing the full surface. */
function makeService(overrides: Partial<ISecurityService> = {}): ISecurityService {
  return {
    getReadFilter: async () => undefined,
    getReadableFields: async () => [],
    resolvePermissionSetNames: async () => [],
    explain: async () => ({}) as any,
    listAudienceBindingSuggestions: async () => ({
      suggestions: [],
      synced: { created: 0, confirmedObserved: 0, pruned: 0 },
    }),
    confirmAudienceBindingSuggestion: async () => ({ suggestion: {}, bindingCreated: true }),
    dismissAudienceBindingSuggestion: async () => ({ suggestion: {} }),
    ...overrides,
  };
}

describe('Security Service Contract', () => {
  it('a full implementation satisfies the surface', () => {
    const service = makeService();
    for (const m of [
      'getReadFilter',
      'getReadableFields',
      'resolvePermissionSetNames',
      'explain',
      'listAudienceBindingSuggestions',
      'confirmAudienceBindingSuggestion',
      'dismissAudienceBindingSuggestion',
    ] as const) {
      expect(typeof service[m]).toBe('function');
    }
  });

  it('getReadFilter: undefined means NO row restriction — the only thing it may mean', async () => {
    // A deny is expressed as a filter that matches nothing, never as `undefined`,
    // so a consumer can safely read `undefined` as "apply no filter".
    const open = makeService({ getReadFilter: async () => undefined });
    await expect(open.getReadFilter('deal', { userId: 'u1' })).resolves.toBeUndefined();

    const denied = makeService({ getReadFilter: async () => ({ id: { $eq: null } }) as any });
    await expect(denied.getReadFilter('deal', { userId: 'u1' })).resolves.toBeDefined();
  });

  it('getReadableFields: undefined (no answer) and [] (nothing readable) are opposite answers', async () => {
    const noAnswer = makeService({ getReadableFields: async () => undefined });
    // `undefined` → the caller must fall back to its own projection…
    await expect(noAnswer.getReadableFields('deal', { userId: 'u1' })).resolves.toBeUndefined();

    const nothingReadable = makeService({ getReadableFields: async () => [] });
    // …whereas `[]` is authoritative: expose no columns at all.
    await expect(nothingReadable.getReadableFields('deal', { userId: 'u1' })).resolves.toEqual([]);
  });

  it('a system context is a full field-level bypass', async () => {
    const service = makeService({
      getReadableFields: async (_object, context) =>
        context?.isSystem ? ['id', 'name', 'secret'] : ['id', 'name'],
    });
    await expect(service.getReadableFields('deal', { isSystem: true }))
      .resolves.toEqual(['id', 'name', 'secret']);
    await expect(service.getReadableFields('deal', { userId: 'u1' }))
      .resolves.toEqual(['id', 'name']);
  });

  it('a partial implementation is feature-detectable rather than wrong', () => {
    // Consumers probe (`typeof svc.getReadableFields === 'function'`) so an
    // implementation may omit a method it cannot honour and still be usable.
    const partial: Partial<ISecurityService> = { getReadFilter: async () => undefined };
    expect(typeof partial.getReadFilter).toBe('function');
    expect(typeof partial.getReadableFields).toBe('undefined');
  });

  it('explain accepts a record-scoped request and an explicit target user', async () => {
    const seen: unknown[] = [];
    const service = makeService({
      explain: async (request) => { seen.push(request); return {} as any; },
    });
    await service.explain(
      { object: 'deal', operation: 'update', userId: 'u2', recordId: 'r1' },
      { userId: 'admin' },
    );
    expect(seen[0]).toEqual({ object: 'deal', operation: 'update', userId: 'u2', recordId: 'r1' });
  });
});
