/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6813 — neither permission provider may move the context value's
 * identity while the inputs it is derived from are unchanged.
 *
 * `PermissionProvider` built its value in a `useMemo` over four `useCallback`s
 * and `MePermissionsProvider` in a `useMemo` over six. Neither carries a
 * semantic guarantee: React may discard the cache and recompute even when the
 * dependency list compares equal, and every factory here builds a fresh
 * object. A discard therefore handed `PermCtx.Provider` a NEW context value
 * with every permission it carries unchanged — which moves the key
 * `usePermissions()` caches on (objectui#6724) and re-runs the whole consumer
 * chain: `ListView`'s data-fetch effect (an extra `dataSource.find`),
 * `DetailView`'s gatedSchema, `ObjectForm`/`ModalForm`/`ObjectGrid`/
 * `RelatedList` — 9 dependency arrays across 6 files naming the whole object,
 * measured on `1e14d70ae`.
 *
 * ⚠️ WHAT IS AND IS NOT OBSERVABLE TODAY. This file pins a LATENT hazard, not
 * a reproduction, and must not be read as a bug being fixed. On React 19.2.8
 * (this repo's pinned version) the cache is NOT discarded spontaneously —
 * measured while objectui#6724 landed: 51 re-renders with no provider, 51 with
 * one and 42 under `StrictMode` each returned ONE identity — and there is no
 * `Activity`/Offscreen subtree in this repo, which is the documented case
 * where React does throw memo caches away. So the discard below is FORCED by a
 * proxy, because React will not do it on its own and a pin that does not force
 * one would prove nothing here.
 *
 * The proxy patches `useMemo` AND `useCallback` at the MODULE level: the
 * providers reach them through their own `import { … } from 'react'` bindings,
 * and `vi.spyOn`/assignment/`defineProperty` on the frozen `[object Module]`
 * namespace all fail to patch those — silently leaving any pin built on them
 * unfalsifiable. Same technique and same reason as
 * `usePermissions.discardedIdentity.test.tsx` (objectui#6724) and
 * `plugin-list/src/__tests__/ListView.discardedExpandFieldsMemo.test.tsx`
 * (objectui#6697). It differs from those in one way that matters here: it
 * discards EVERY armed memo and callback rather than ones matched by a marker
 * dependency, because the fix under test removes the dependency arrays
 * altogether — a marker-matched proxy would have nothing left to match and
 * would go green for the trivial reason.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import * as ReactNS from 'react';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { PermCtx, type PermissionContextValue } from '../PermissionContext';
import { usePermissions } from '../usePermissions';
import { PermissionProvider } from '../PermissionProvider';
import { MePermissionsProvider, type MePermissionsResponse } from '../MePermissionsProvider';

const memoProxy = vi.hoisted(() => ({ armed: false, epoch: 0 }));

vi.mock('react', async (importOriginal) => {
  // `<any>` matches the sibling pins (objectui#6697 / #6724) and is
  // load-bearing: a precise module type makes the real hooks' deps parameter
  // `DependencyList`, which the patched signatures below cannot satisfy.
  const actual = await importOriginal<any>();
  const realUseMemo = actual.useMemo;
  const realUseCallback = actual.useCallback;
  const patchedUseMemo = (factory: () => unknown, deps?: unknown[]) =>
    memoProxy.armed && Array.isArray(deps)
      ? realUseMemo(factory, [...deps, memoProxy.epoch])
      : realUseMemo(factory, deps);
  const patchedUseCallback = (fn: unknown, deps?: unknown[]) =>
    memoProxy.armed && Array.isArray(deps)
      ? realUseCallback(fn, [...deps, memoProxy.epoch])
      : realUseCallback(fn, deps);
  return {
    ...actual,
    useMemo: patchedUseMemo,
    useCallback: patchedUseCallback,
    default: {
      ...(actual.default ?? actual),
      useMemo: patchedUseMemo,
      useCallback: patchedUseCallback,
    },
  };
});

/** Put EVERY memo and callback in the tree under this file's control. */
function armDiscardProxy(): () => void {
  memoProxy.armed = true;
  return () => {
    memoProxy.armed = false;
  };
}
/** Throw away every armed cache — one discard event, on demand. */
function discardNow(): void {
  memoProxy.epoch += 1;
}

afterEach(() => {
  cleanup();
  memoProxy.armed = false;
});

/** Records the ctx the provider published, what a consumer saw, and effect runs. */
function makeProbe() {
  const ctxSeen: (PermissionContextValue | null)[] = [];
  const permsSeen: ReturnType<typeof usePermissions>[] = [];
  const effectRuns: unknown[] = [];
  const Probe: React.FC = () => {
    // The provider's own output, and the consumer-visible object one link
    // downstream. objectui#6724 made the second stable while the FIRST is
    // unchanged, so both are asserted here: that is the end-to-end claim.
    ctxSeen.push(ReactNS.useContext(PermCtx));
    const perms = usePermissions();
    permsSeen.push(perms);
    // Exactly the consumer shape this card is about: `ListView`'s data-fetch
    // effect names the whole object in its dependency array.
    ReactNS.useEffect(() => {
      effectRuns.push(perms);
    }, [perms]);
    return null;
  };
  return { ctxSeen, permsSeen, effectRuns, Probe };
}

const ROLES: RoleDefinition[] = [{ name: 'restricted', label: 'Restricted' } as RoleDefinition];
const PERMISSIONS: ObjectPermissionConfig[] = [
  {
    object: 'accounts',
    roles: {
      restricted: {
        fieldPermissions: [{ field: 'secret', read: false, write: false }],
        rowPermissions: [{ filter: 'owner_id = me' }],
      },
    },
  } as unknown as ObjectPermissionConfig,
];
const USER_ROLES = ['restricted'];

const ME: MePermissionsResponse = {
  authenticated: true,
  userId: 'u-1',
  tenantId: 't-1',
  roles: ['restricted'],
  permissionSets: ['ps-1'],
  systemPermissions: ['manage_app'],
  objects: { accounts: { allowRead: true, allowEdit: false, apiOperations: ['find'] } },
  fields: { 'accounts.secret': { readable: false, editable: false } },
};

describe('the discard proxy really reaches the binding the providers use (objectui#6813)', () => {
  it('provesTheProxyDiscriminates: an armed memo AND an armed callback are both discarded', () => {
    const memos: unknown[] = [];
    const callbacks: unknown[] = [];
    const Probe: React.FC = () => {
      memos.push(ReactNS.useMemo(() => ({}), []));
      callbacks.push(ReactNS.useCallback(() => {}, []));
      return null;
    };

    const restore = armDiscardProxy();
    try {
      const { rerender } = render(<Probe />);
      // Armed but not fired: normal caching still holds, so a green below
      // cannot be green because the proxy breaks caching outright.
      rerender(<Probe />);
      expect(memos[1]).toBe(memos[0]);
      expect(callbacks[1]).toBe(callbacks[0]);

      discardNow();
      rerender(<Probe />);
    } finally {
      restore();
    }
    expect(memos[2]).not.toBe(memos[1]);
    expect(callbacks[2]).not.toBe(callbacks[1]);
  });
});

describe('PermissionProvider — ctx identity survives a discarded cache (objectui#6813)', () => {
  it('keeps ONE ctx identity across a discard while the props are unchanged', () => {
    const { ctxSeen, permsSeen, effectRuns, Probe } = makeProbe();
    const tree = () => (
      <PermissionProvider roles={ROLES} permissions={PERMISSIONS} userRoles={USER_ROLES}>
        <Probe />
      </PermissionProvider>
    );

    const restore = armDiscardProxy();
    try {
      const { rerender } = render(tree());
      rerender(tree());
      expect(new Set(ctxSeen).size).toBe(1);

      // Two discards, each followed by a re-render with the SAME props.
      // Nothing an author or a caller controls has changed.
      discardNow();
      rerender(tree());
      discardNow();
      rerender(tree());
    } finally {
      restore();
    }

    expect(new Set(ctxSeen).size).toBe(1);
    expect(new Set(permsSeen).size).toBe(1);
    // The observable the card names, modelled at its source: the consuming
    // effect must not re-run, so there is no redundant `dataSource.find`.
    expect(effectRuns).toHaveLength(1);
  });

  it('keeps the member identities three consumers name in dependency arrays', () => {
    const { ctxSeen, Probe } = makeProbe();
    const tree = () => (
      <PermissionProvider roles={ROLES} permissions={PERMISSIONS} userRoles={USER_ROLES} user={undefined}>
        <Probe />
      </PermissionProvider>
    );

    const restore = armDiscardProxy();
    try {
      const { rerender } = render(tree());
      discardNow();
      rerender(tree());
    } finally {
      restore();
    }

    const first = ctxSeen[0]!;
    const last = ctxSeen[ctxSeen.length - 1]!;
    // `RecordDetailView`, `ObjectDataPage` and `ObjectView` each name
    // `getObjectApiOperations` in a `useMemo` dependency array.
    expect(last.getObjectApiOperations).toBe(first.getObjectApiOperations);
    // `useFieldPermissions` names both of these in its own dependency arrays.
    expect(last.checkField).toBe(first.checkField);
    expect(last.getFieldPermissions).toBe(first.getFieldPermissions);
    expect(last.check).toBe(first.check);
    expect(last.getRowFilter).toBe(first.getRowFilter);
    expect(last.hasCapabilities).toBe(first.hasCapabilities);
  });

  it('still publishes a NEW ctx when the permissions genuinely change, carrying the new answers', () => {
    const { ctxSeen, effectRuns, Probe } = makeProbe();
    const OPEN: ObjectPermissionConfig[] = [
      { object: 'accounts', roles: { restricted: { fieldPermissions: [] } } } as unknown as ObjectPermissionConfig,
    ];
    const tree = (permissions: ObjectPermissionConfig[]) => (
      <PermissionProvider roles={ROLES} permissions={permissions} userRoles={USER_ROLES}>
        <Probe />
      </PermissionProvider>
    );

    const { rerender } = render(tree(PERMISSIONS));
    rerender(tree(OPEN));

    const first = ctxSeen[0]!;
    const last = ctxSeen[ctxSeen.length - 1]!;
    expect(last).not.toBe(first);
    expect(effectRuns).toHaveLength(2);
    // …and the new identity answers with the NEW permissions, not a stale
    // snapshot: `secret` was denied under PERMISSIONS and is open under OPEN.
    expect(first.checkField('accounts', 'secret', 'read')).toBe(false);
    expect(last.checkField('accounts', 'secret', 'read')).toBe(true);
    expect(first.getRowFilter('accounts')).toBe('owner_id = me');
    expect(last.getRowFilter('accounts')).toBeUndefined();
  });

  it('answers exactly what it answered before the discard', () => {
    const { ctxSeen, Probe } = makeProbe();
    const tree = () => (
      <PermissionProvider roles={ROLES} permissions={PERMISSIONS} userRoles={USER_ROLES}>
        <Probe />
      </PermissionProvider>
    );

    const restore = armDiscardProxy();
    try {
      const { rerender } = render(tree());
      discardNow();
      rerender(tree());
    } finally {
      restore();
    }

    const readAll = (c: PermissionContextValue) => ({
      checkFieldOpen: c.checkField('accounts', 'name', 'read'),
      checkFieldDenied: c.checkField('accounts', 'secret', 'read'),
      fieldPerms: c.getFieldPermissions('accounts'),
      rowFilter: c.getRowFilter('accounts'),
      apiOps: c.getObjectApiOperations('accounts'),
      roles: c.roles,
      userId: c.userId,
      systemPermissions: c.systemPermissions,
      capabilities: c.hasCapabilities(['anything']),
      isLoaded: c.isLoaded,
    });
    const expected = {
      checkFieldOpen: true,
      checkFieldDenied: false,
      fieldPerms: [{ field: 'secret', read: false, write: false }],
      rowFilter: 'owner_id = me',
      // [#3391] role-based provider models no effective API operation set.
      apiOps: undefined,
      roles: USER_ROLES,
      // [objectui#5683] never learns who the user IS.
      userId: null,
      // [objectui#4656] unreported, NOT a reported-empty grant — and
      // `hasCapabilities` stays fail-open on it.
      systemPermissions: undefined,
      capabilities: true,
      isLoaded: true,
    };
    expect(readAll(ctxSeen[0]!)).toEqual(expected);
    expect(readAll(ctxSeen[ctxSeen.length - 1]!)).toEqual(expected);
  });

  it('two providers given the same inputs cannot evict each other', () => {
    // This is what makes the cache immune rather than merely lucky: a single
    // slot comparing a stored dependency list would be SHARED by both trees
    // below, so each render would evict the other's entry and churn the very
    // identity this card is about. Keying on the input tuple has no such slot.
    const a = makeProbe();
    const b = makeProbe();
    const tree = () => (
      <>
        <PermissionProvider roles={ROLES} permissions={PERMISSIONS} userRoles={USER_ROLES}>
          <a.Probe />
        </PermissionProvider>
        <PermissionProvider roles={ROLES} permissions={PERMISSIONS} userRoles={USER_ROLES}>
          <b.Probe />
        </PermissionProvider>
      </>
    );

    const restore = armDiscardProxy();
    try {
      const { rerender } = render(tree());
      rerender(tree());
      discardNow();
      rerender(tree());
    } finally {
      restore();
    }

    expect(new Set(a.ctxSeen).size).toBe(1);
    expect(new Set(b.ctxSeen).size).toBe(1);
    expect(b.ctxSeen[0]).toBe(a.ctxSeen[0]);
    expect(a.effectRuns).toHaveLength(1);
    expect(b.effectRuns).toHaveLength(1);
  });
});

describe('MePermissionsProvider — ctx identity survives a discarded cache (objectui#6813)', () => {
  it('keeps ONE ctx identity across a discard while the fetched data is unchanged', () => {
    const { ctxSeen, permsSeen, effectRuns, Probe } = makeProbe();
    const tree = () => (
      <MePermissionsProvider initialPermissions={ME}>
        <Probe />
      </MePermissionsProvider>
    );

    const restore = armDiscardProxy();
    try {
      const { rerender } = render(tree());
      rerender(tree());
      expect(new Set(ctxSeen).size).toBe(1);

      discardNow();
      rerender(tree());
      discardNow();
      rerender(tree());
    } finally {
      restore();
    }

    expect(new Set(ctxSeen).size).toBe(1);
    expect(new Set(permsSeen).size).toBe(1);
    expect(effectRuns).toHaveLength(1);
  });

  it('keeps the member identities and the answers across a discard', () => {
    const { ctxSeen, Probe } = makeProbe();
    const tree = () => (
      <MePermissionsProvider initialPermissions={ME}>
        <Probe />
      </MePermissionsProvider>
    );

    const restore = armDiscardProxy();
    try {
      const { rerender } = render(tree());
      discardNow();
      rerender(tree());
    } finally {
      restore();
    }

    const first = ctxSeen[0]!;
    const last = ctxSeen[ctxSeen.length - 1]!;
    expect(last.getObjectApiOperations).toBe(first.getObjectApiOperations);
    expect(last.checkField).toBe(first.checkField);
    expect(last.getFieldPermissions).toBe(first.getFieldPermissions);
    expect(last.check).toBe(first.check);
    expect(last.getRowFilter).toBe(first.getRowFilter);

    const readAll = (c: PermissionContextValue) => ({
      checkAllowed: c.check('accounts', 'read').allowed,
      checkDenied: c.check('accounts', 'update').allowed,
      checkFieldDenied: c.checkField('accounts', 'secret', 'read'),
      apiOps: c.getObjectApiOperations('accounts'),
      rowFilter: c.getRowFilter('accounts'),
      roles: c.roles,
      userId: c.userId,
      systemPermissions: c.systemPermissions,
      capHeld: c.hasCapabilities(['manage_app']),
      capMissing: c.hasCapabilities(['manage_billing']),
      isLoaded: c.isLoaded,
    });
    const expected = {
      checkAllowed: true,
      checkDenied: false,
      checkFieldDenied: false,
      apiOps: ['find'],
      rowFilter: undefined,
      roles: ['restricted'],
      userId: 'u-1',
      systemPermissions: ['manage_app'],
      capHeld: true,
      capMissing: false,
      isLoaded: true,
    };
    expect(readAll(first)).toEqual(expected);
    expect(readAll(last)).toEqual(expected);
  });

  it('still publishes a NEW ctx when the fetched permissions genuinely change', async () => {
    // Driven through the FETCH, which is the only way this provider's data
    // actually changes: `initialPermissions` seeds `useState` and is ignored on
    // every later render, so re-rendering with a different one would assert
    // nothing (it measured exactly that until this comment was written).
    const { ctxSeen, Probe } = makeProbe();
    const OPENED: MePermissionsResponse = {
      ...ME,
      objects: { accounts: { allowRead: true, allowEdit: true } },
      fields: {},
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(String(input).includes('/v2') ? OPENED : ME), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const tree = (endpoint: string) => (
      <MePermissionsProvider endpoint={endpoint} fetcher={fetcher}>
        <Probe />
      </MePermissionsProvider>
    );

    const { rerender } = render(tree('/v1/me/permissions'));
    await waitFor(() => expect(ctxSeen.length).toBeGreaterThan(0));
    const first = ctxSeen[ctxSeen.length - 1]!;
    expect(first.checkField('accounts', 'secret', 'write')).toBe(false);
    expect(first.getObjectApiOperations('accounts')).toEqual(['find']);

    rerender(tree('/v2/me/permissions'));
    await waitFor(() => expect(ctxSeen[ctxSeen.length - 1]).not.toBe(first));

    const last = ctxSeen[ctxSeen.length - 1]!;
    // A genuine permission change must reach every consumer — the cache keys on
    // the fetched payload's identity, so a DIFFERENT payload cannot collide
    // onto the entry the previous one made.
    expect(last.checkField('accounts', 'secret', 'write')).toBe(true);
    expect(last.getObjectApiOperations('accounts')).toBeUndefined();
    expect(last.check('accounts', 'update').allowed).toBe(true);
  });
});

/**
 * objectui#6862 — the EFFECT end of the same provider, and a different shape
 * from the value end above.
 *
 * `MePermissionsProvider` built its fetch driver in a `useCallback` over
 * `[endpoint, fetcher, maxRetries, retryBaseDelayMs]` and named THAT CALLBACK
 * as its fetch effect's dependency. A discard rebuilds the callback with a new
 * identity, so the effect tears down and re-runs with none of the four inputs
 * changed — one redundant `/api/v1/auth/me/permissions` round trip on the
 * provider that gates the whole console.
 *
 * ⚠️ WHY THESE PINS FORCE A DISCARD. Exactly the reason recorded at the top of
 * this file: React does not discard spontaneously here (51 / 51 / 42 re-renders
 * each returned ONE identity on the pinned React 19.2.8, and this repo still
 * has no `Activity`/Offscreen subtree — re-verified for this card: zero imports
 * of `Activity` from `react`, against 179 files importing `useMemo` from it on
 * the same command shape). ⇒ An ordinary render-count or effect-count pin here
 * would be GREEN on the defect AND on the fix, and would therefore assert
 * nothing. The discriminating input is a FORCED discard, so the proxy above is
 * armed and fired for the first pin. The three that follow are deliberately
 * NOT armed: they are the non-regression axis, and what they must survive is a
 * fix that over-reaches rather than a discard.
 *
 * ⚠️ AND WHY THE FIRST PIN COUNTS REQUESTS. An identity comparison alone can
 * hold while the effect re-runs for some other reason, so the observable the
 * card actually names — the number of `/me/permissions` requests — is asserted
 * directly. Requests are served from a double passed as the `fetcher` prop, so
 * nothing here can reach happy-dom's `http://localhost:3000` and be attributed
 * to this file by the network-escape guard (objectui#8537).
 */
describe('MePermissionsProvider — the fetch effect survives a discarded cache (objectui#6862)', () => {
  /**
   * A fetch double that records who was called with what, and answers with a
   * payload naming itself. The tag rides on `userId`, which the context value
   * publishes — so a pin can tell a REAL refetch from a driver that has been
   * mutated into answering one constant for every input.
   */
  function makeFetcher(tag: string, log: string[]): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      log.push(`${tag} ${String(input)}`);
      return new Response(JSON.stringify({ ...ME, userId: tag }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }

  /**
   * Give a re-run effect a real turn to issue its request. Asserting the
   * ABSENCE of a round trip needs a settle window; `waitFor` cannot express it.
   */
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it('costs no redundant round trip when a discard rebuilds the driver, inputs unchanged', async () => {
    const log: string[] = [];
    const fetcher = makeFetcher('A', log);
    const { ctxSeen, effectRuns, Probe } = makeProbe();
    const tree = () => (
      <MePermissionsProvider endpoint="/api/v1/auth/me/permissions" fetcher={fetcher}>
        <Probe />
      </MePermissionsProvider>
    );

    let loaded: PermissionContextValue | null | undefined;
    const restore = armDiscardProxy();
    try {
      const { rerender } = render(tree());
      // ⚠️ objectui#8688 — wait on the recorder the NEXT LINE READS, not on
      // `log`. `log` is pushed when the request is ISSUED; `ctxSeen` only fills
      // once the response has landed, because this provider renders
      // `loadingFallback` — not `children` — while `loading && !data`. So a
      // wait on `log` does not gate this read at all. Its failure here is the
      // QUIET one: `loaded` is `undefined`, and the identity pin below then
      // compares `undefined` to `undefined` and goes GREEN — an implementation
      // strictly worse than the bug passes it. Measured: under a forced
      // ordering this test failed only on `effectRuns`, with the identity pin
      // passing vacuously. Waiting on the fetched payload's own tag couples the
      // wait to the read so the two cannot drift apart again.
      await waitFor(() => expect(ctxSeen[ctxSeen.length - 1]?.userId).toBe('A'));
      loaded = ctxSeen[ctxSeen.length - 1];

      // Armed but NOT fired: an ordinary re-render must not refetch either, so
      // a green below cannot come from the proxy having broken caching outright.
      rerender(tree());
      await settle();
      expect(log).toHaveLength(1);

      // Two discards, each followed by a re-render with the SAME four inputs.
      discardNow();
      rerender(tree());
      discardNow();
      rerender(tree());
      await settle();
    } finally {
      restore();
    }

    // THE observable this card names: a request count, not an identity compare.
    expect(log).toEqual(['A /api/v1/auth/me/permissions']);
    // …and the consequence that OUTLIVES the round trip. `setData` installs a
    // fresh payload object even for a byte-identical answer, and that object is
    // the key objectui#6813's caches are built on — so a discard that refetches
    // walks straight through the guard #6813 landed: the ctx identity moves
    // permanently (not just the transient `isLoaded` flip the card describes)
    // and every consumer effect downstream re-runs.
    expect(ctxSeen[ctxSeen.length - 1]).toBe(loaded);
    expect(effectRuns).toHaveLength(1);
  });

  /**
   * The non-regression axis, from the plausible WRONG fix rather than from the
   * bug's shape: dropping the dependency altogether would also stop the
   * redundant round trip — and would stop every LEGITIMATE refetch with it. The
   * three pins below fail on such a fix. Together they cover all four inputs the
   * discarded `useCallback` named, which is the parity claim: the fix removes
   * React's licence to discard and narrows nothing else.
   */
  it('still refetches exactly once when the endpoint genuinely changes', async () => {
    const log: string[] = [];
    const fetcher = makeFetcher('A', log);
    const { Probe } = makeProbe();
    const tree = (endpoint: string) => (
      <MePermissionsProvider endpoint={endpoint} fetcher={fetcher}>
        <Probe />
      </MePermissionsProvider>
    );

    const { rerender } = render(tree('/v1/me/permissions'));
    await waitFor(() => expect(log).toHaveLength(1));

    rerender(tree('/v2/me/permissions'));
    await waitFor(() => expect(log).toHaveLength(2));
    await settle();
    expect(log).toEqual(['A /v1/me/permissions', 'A /v2/me/permissions']);
  });

  it('still refetches exactly once when the fetcher itself is swapped', async () => {
    // ⚠️ Two CONCRETE, distinguishable fetchers. `fetcher` is optional, and a
    // pin that swapped one `undefined` for another would prove nothing: it is
    // green on a fix that never refetches at all, because the two compare equal.
    const log: string[] = [];
    const fetcherA = makeFetcher('A', log);
    const fetcherB = makeFetcher('B', log);
    const { ctxSeen, Probe } = makeProbe();
    const tree = (f: typeof fetch) => (
      <MePermissionsProvider endpoint="/me/permissions" fetcher={f}>
        <Probe />
      </MePermissionsProvider>
    );

    const { rerender } = render(tree(fetcherA));
    // ⚠️ objectui#8688 — the wait must gate the array the assertion READS.
    // This waited on `log` and then read `ctxSeen`, a DIFFERENT array; nothing
    // established `ctxSeen` had been filled, so `ctxSeen[-1]` was `undefined`
    // and the `!` turned "this can be empty" into a compile-time promise that
    // it cannot be. It threw `TypeError: Cannot read properties of undefined
    // (reading 'userId')` on PR #8656's shard 2/4 — a red on a `packages/core`
    // test-only PR whose diff cannot reach this package. Folding the assertion
    // INTO the wait keeps the same predicate and makes the drift impossible.
    await waitFor(() => expect(ctxSeen[ctxSeen.length - 1]?.userId).toBe('A'));

    rerender(tree(fetcherB));
    // Not merely "a request happened": the NEW fetcher's answer must reach the
    // context. This is what a driver mutated to answer one constant fails.
    await waitFor(() => expect(ctxSeen[ctxSeen.length - 1]?.userId).toBe('B'));
    await settle();
    expect(log).toEqual(['A /me/permissions', 'B /me/permissions']);
  });

  it('still refetches exactly once when either retry primitive changes', async () => {
    // These two are the remaining members of the four the `useCallback` named.
    // Pinning them is a PARITY claim — the fix must not narrow the trigger set —
    // not an assertion that a retry-tuning knob ought to refetch on its own.
    const log: string[] = [];
    const fetcher = makeFetcher('A', log);
    const { Probe } = makeProbe();
    const tree = (maxRetries: number, retryBaseDelayMs: number) => (
      <MePermissionsProvider
        endpoint="/me/permissions"
        fetcher={fetcher}
        maxRetries={maxRetries}
        retryBaseDelayMs={retryBaseDelayMs}
      >
        <Probe />
      </MePermissionsProvider>
    );

    const { rerender } = render(tree(3, 500));
    await waitFor(() => expect(log).toHaveLength(1));

    rerender(tree(1, 500));
    await waitFor(() => expect(log).toHaveLength(2));

    rerender(tree(1, 20));
    await waitFor(() => expect(log).toHaveLength(3));

    await settle();
    expect(log).toHaveLength(3);
  });
});
