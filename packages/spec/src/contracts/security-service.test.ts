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

  it('[ADR-0106 D7] getMetadataReadableFields is OPTIONAL — absence degrades to getReadableFields', async () => {
    // THE structural pin behind "a deployment whose security service predates
    // ADR-0106 keeps its pre-ADR behaviour". Optional is what makes that a
    // property of the TYPE: such a service still satisfies the contract, and a
    // consumer cannot reach the metadata-plane answer without first handling
    // the absent case.
    const withoutIt: ISecurityService = makeService({ getReadableFields: async () => ['id', 'name'] });
    expect(typeof withoutIt.getMetadataReadableFields).toBe('undefined');

    // The unguarded call does not compile. Never invoked — its only job is to
    // make the COMPILER prove the point (invoking it would merely prove that
    // JavaScript throws on `undefined()`, which is the runtime symptom this
    // declaration exists to prevent).
    const mustNotCompileWithoutAGuard = () =>
      // @ts-expect-error possibly undefined — a consumer must feature-detect first
      withoutIt.getMetadataReadableFields('deal', { userId: 'u1' });
    expect(typeof mustNotCompileWithoutAGuard).toBe('function');

    // The shape consumers actually write (`metadata-core`'s object-schema mask
    // resolver): prefer the metadata-plane answer, fall back to the data-plane
    // one. The fallback is never NARROWER than the metadata-plane answer, which
    // is why degrading here cannot hide columns a caller may see.
    const ask = typeof withoutIt.getMetadataReadableFields === 'function'
      ? withoutIt.getMetadataReadableFields.bind(withoutIt)
      : withoutIt.getReadableFields.bind(withoutIt);
    await expect(ask('deal', { userId: 'u1' })).resolves.toEqual(['id', 'name']);
  });

  it('[ADR-0106 D7] the metadata plane narrows where the data plane falls open', async () => {
    // The one respect in which the two methods differ, and the reason a second
    // method exists at all: a caller resolving to ZERO permission sets falls
    // OPEN on the data plane (mirroring the middleware, which skips its field
    // gate entirely) and resolves the fallback set on the metadata plane, so a
    // guest deployment's schema exposure is a deliberate permission-set
    // decision rather than an accidental everything-default.
    const service = makeService({
      getReadableFields: async () => ['id', 'name', 'secret'],
      getMetadataReadableFields: async (_object, context) =>
        context?.isSystem ? ['id', 'name', 'secret'] : ['id'],
    });

    await expect(service.getReadableFields('deal', {})).resolves.toEqual(['id', 'name', 'secret']);
    await expect(service.getMetadataReadableFields?.('deal', {})).resolves.toEqual(['id']);

    // A system context bypasses on BOTH planes.
    await expect(service.getMetadataReadableFields?.('deal', { isSystem: true }))
      .resolves.toEqual(['id', 'name', 'secret']);

    // …and it inherits getReadableFields' two distinct empty answers, unchanged:
    // `undefined` = no answer (fall back to your own projection), `[]` = the real
    // answer that no field may be disclosed.
    const noAnswer = makeService({ getMetadataReadableFields: async () => undefined });
    await expect(noAnswer.getMetadataReadableFields?.('deal', { userId: 'u1' })).resolves.toBeUndefined();
    const nothingDisclosable = makeService({ getMetadataReadableFields: async () => [] });
    await expect(nothingDisclosable.getMetadataReadableFields?.('deal', { userId: 'u1' })).resolves.toEqual([]);
  });

  it('[#7616] resolvePermissionSetsForContext is OPTIONAL — absence keeps the consumer on its own resolution (compile-time)', () => {
    // THE structural pin behind "a consumer must keep its local resolution as
    // the fallback until a floor version carrying this method can be assumed".
    // Optional is what makes that a property of the TYPE: a security service
    // that predates the method still satisfies the contract, and the unguarded
    // call does not compile, so the fallback branch cannot be dropped by
    // accident on the way to a delegation that a deployment may not support.
    const withoutIt: ISecurityService = makeService();
    expect(typeof withoutIt.resolvePermissionSetsForContext).toBe('undefined');

    // Never invoked — its only job is to make the COMPILER prove the point.
    const mustNotCompileWithoutAGuard = () =>
      // @ts-expect-error possibly undefined — a consumer must feature-detect first
      withoutIt.resolvePermissionSetsForContext({ userId: 'u1' });
    expect(typeof mustNotCompileWithoutAGuard).toBe('function');

    // The names-only sibling is NOT optional and stays reachable unguarded —
    // the two are different questions, not two spellings of one, so a service
    // carrying only the older method is a complete implementation.
    expect(typeof withoutIt.resolvePermissionSetNames).toBe('function');
  });

  it('[#7616] the sets carry the four columns the names cannot: objects, fields, systemPermissions, tabPermissions', async () => {
    // Why the method exists at all. `resolvePermissionSetNames` answers an
    // AUDIENCE question ("does this caller hold `sales_manager`?"); a consumer
    // that must MERGE the caller's grants — the object/field map
    // `/auth/me/permissions` serves, the capability + tab surface `/me/apps`
    // filters with — cannot reach any of these four from a name, which is
    // exactly why those two endpoints re-implement set resolution locally.
    const service = makeService({
      resolvePermissionSetNames: async () => ['member_default', 'sales_manager'],
      resolvePermissionSetsForContext: async () => [
        {
          name: 'member_default',
          objects: { deal: { allowRead: true } },
          fields: { 'deal.amount': { readable: true, editable: false } },
          systemPermissions: [],
          tabPermissions: { app_crm: 'default_on' },
        },
        {
          name: 'sales_manager',
          objects: { deal: { allowRead: true, allowEdit: true } },
          fields: { 'deal.amount': { readable: true, editable: true } },
          systemPermissions: ['setup.access'],
          tabPermissions: { app_crm: 'visible' },
        },
      ] as any,
    });

    const sets = await service.resolvePermissionSetsForContext?.({ userId: 'u1' });
    expect(sets?.map((s) => s.name)).toEqual(['member_default', 'sales_manager']);
    // The names surface answers the audience question over the SAME resolution…
    await expect(service.resolvePermissionSetNames({ userId: 'u1' }))
      .resolves.toEqual(['member_default', 'sales_manager']);
    // …and nothing else. Every column below is unreachable from that list.
    expect(sets?.[1]?.objects).toBeDefined();
    expect(sets?.[1]?.fields).toBeDefined();
    expect(sets?.[1]?.systemPermissions).toEqual(['setup.access']);
    expect(sets?.[1]?.tabPermissions).toEqual({ app_crm: 'visible' });

    // The merge stays with the CALLER — this contract hands over the INPUT to
    // it, unmerged and in resolution order, because two consumers legitimately
    // project different subsets of the same sets. Folding a merge in here would
    // make the method a fourth copy of the rule rather than the one source of
    // its input.
    expect(sets).toHaveLength(2);
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
