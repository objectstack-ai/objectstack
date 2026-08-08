// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type {
  ISecurityService,
  AuthoredRowWriteVerdict,
  AuthoredRowWriteOperation,
} from './security-service';

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
    canExport: async () => true,
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
      'canExport',
      'resolvePermissionSetNames',
      'explain',
      'listAudienceBindingSuggestions',
      'confirmAudienceBindingSuggestion',
      'dismissAudienceBindingSuggestion',
    ] as const) {
      expect(typeof service[m]).toBe('function');
    }
  });

  it('canExport: an access-narrowing answer — false denies, and absence is feature-detectable', async () => {
    // [#3544] The bulk-egress question. It fails CLOSED, so a consumer must
    // never read a `false` (or a throw) as "no restriction" the way it may
    // read getReadFilter's `undefined`.
    const denied = makeService({ canExport: async () => false });
    await expect(denied.canExport('deal', { userId: 'u1' })).resolves.toBe(false);

    const allowed = makeService({ canExport: async () => true });
    await expect(allowed.canExport('deal', { userId: 'u1' })).resolves.toBe(true);

    // A system context bypasses, mirroring the engine middleware's isSystem skip.
    const service = makeService({ canExport: async (_object, context) => context?.isSystem === true });
    await expect(service.canExport('deal', { isSystem: true })).resolves.toBe(true);
    await expect(service.canExport('deal', { userId: 'u1' })).resolves.toBe(false);
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

  it('[#5493] AuthoredRowWriteVerdict names exactly admit / abstain (compile-time)', () => {
    const everyVerdict: AuthoredRowWriteVerdict[] = ['admit', 'abstain'];
    // Deliberately NO `deny`. This surface is evidence, not a gate: the caller
    // already holds a refusal and asks only whether a declared widener speaks
    // for the row. "No evidence" and "evidence against" are the same
    // instruction to that caller — keep refusing — so a third state would be
    // one nobody could act on differently.
    // @ts-expect-error `deny` is not a state this contract defines
    const notAVerdict: AuthoredRowWriteVerdict = 'deny';
    expect(everyVerdict).toHaveLength(2);
    expect(notAVerdict).toBe('deny');

    // The operation axis is the RLS WRITE vocabulary, not the engine verb list:
    // a caller maps `purge`/`transfer`/`restore` onto its nearest write class
    // itself, so a new lifecycle verb cannot acquire a widening path here just
    // by being spelled into a wider union.
    const everyOperation: AuthoredRowWriteOperation[] = ['update', 'delete'];
    // @ts-expect-error `select` is a read class — this surface answers writes only
    const notAWriteOperation: AuthoredRowWriteOperation = 'select';
    expect(everyOperation).toHaveLength(2);
    expect(notAWriteOperation).toBe('select');
  });

  it('[#5493] checkAuthoredRowWrite is OPTIONAL — absence is the fail-closed default (compile-time)', () => {
    // THE structural pin behind "a deployment without this method behaves
    // byte-for-byte as today". Declaring it optional is what makes that a
    // property of the TYPE rather than a promise in prose: a security service
    // that predates the method still satisfies the contract, and TypeScript
    // forces every consumer to handle the absent case instead of calling into
    // `undefined` at runtime.
    const withoutIt: ISecurityService = makeService();
    expect(typeof withoutIt.checkAuthoredRowWrite).toBe('undefined');

    // …and a consumer cannot forget: the unguarded call does not compile.
    // Never invoked — its only job is to make the COMPILER prove the point
    // (invoking it would merely prove that JavaScript throws on `undefined()`,
    // which is the runtime symptom this declaration exists to prevent).
    const mustNotCompileWithoutAGuard = () =>
      // @ts-expect-error possibly undefined — a consumer must feature-detect first
      withoutIt.checkAuthoredRowWrite('deal', 'r1', 'update', {});
    expect(typeof mustNotCompileWithoutAGuard).toBe('function');

    // The guarded form is the one that compiles, and it degrades to `undefined`
    // — which the caller reads as `abstain` (see the case below).
    expect(withoutIt.checkAuthoredRowWrite?.('deal', 'r1', 'update', {})).toBeUndefined();
  });

  it('[#5493] admit is a positive measurement; every other outcome is abstain', async () => {
    // `admit` means "an app-authored, non-floor policy matches this row for
    // this operation" — it never means "the write is permitted" (CRUD, the
    // tenant wall, sharing and the post-image check all still apply), and it is
    // never reported for a reason the implementation did not measure.
    const admitting = makeService({
      checkAuthoredRowWrite: async (_object, recordId) =>
        recordId === 'r_open' ? 'admit' : 'abstain',
    });
    await expect(admitting.checkAuthoredRowWrite?.('deal', 'r_open', 'update', { userId: 'u1' }))
      .resolves.toBe('admit');
    // The #5493 probe E-A shape: a row a platform-floor policy would admit, but
    // no authored policy names. The verdict is `abstain`, never `admit`.
    await expect(admitting.checkAuthoredRowWrite?.('deal', 'r_transferred', 'update', { userId: 'u1' }))
      .resolves.toBe('abstain');

    // Fail-closed, and it is the INVERSE of SharingWriteVerdict's: there a
    // failed lookup must be `deny` because `abstain` hands the decision on;
    // here the caller uses `admit` to WIDEN, so the answer that changes nothing
    // is `abstain`. The method returns a verdict rather than throwing.
    const failing = makeService({ checkAuthoredRowWrite: async () => 'abstain' });
    await expect(failing.checkAuthoredRowWrite?.('deal', 'r_open', 'update', { userId: 'u1' }))
      .resolves.toBe('abstain');

    // Absence and `abstain` are ONE instruction to the caller, which is what
    // lets a consumer collapse feature detection and the verdict into a single
    // non-widening branch.
    const absent = makeService();
    const verdict = (await absent.checkAuthoredRowWrite?.('deal', 'r_open', 'update', {})) ?? 'abstain';
    expect(verdict).toBe('abstain');
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
