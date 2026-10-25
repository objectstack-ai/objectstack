/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6724 — `usePermissions()`'s returned identity must not churn while
 * the permission context is unchanged.
 *
 * Consumers put this hook's return value straight into dependency arrays:
 * `ListView`'s data-fetch effect names it as `perms`, and `DetailView`,
 * `ObjectForm`, `ModalForm`, `ObjectGrid` and `RelatedList` name it in memo
 * deps (13 dependency arrays across 6 files, measured on `26896c689`). The
 * hook used to cache its return in a `useMemo` keyed on `[ctx]`, and BOTH of
 * its branches build a fresh object — an object literal with no provider, a
 * spread of `ctx` with one. `useMemo` carries no semantic guarantee: React
 * may discard the cache and recompute even when `[ctx]` compares equal, so a
 * discard alone moved the identity while every permission it carries stayed
 * the same, and the consuming effect re-ran.
 *
 * ⚠️ WHAT IS AND IS NOT OBSERVABLE TODAY — measured here rather than assumed,
 * because the card reasons from React's documented licence and not from a
 * reproduction. On React 19.2.8 (this repo's pinned version) the cache is NOT
 * discarded spontaneously: 51 re-renders with no provider, 51 with one, and
 * 42 under `StrictMode` all returned ONE identity. There is no `<Activity>` /
 * Offscreen subtree in this repo either, which is the documented case where
 * React does throw memo caches away. So this is a LATENT hazard — a
 * correctness dependency resting on a licence React has not yet exercised
 * here — not a bug reproducible from user actions today. The discard is
 * forced below by a proxy, which is the only way to exercise it; the first
 * case proves the proxy really reaches the binding the hook uses, so the
 * greens below cannot be green for the trivial reason.
 *
 * The discard has to be forced at the MODULE level: the hook reached
 * `useMemo` through its own `import { useMemo } from 'react'` binding, and
 * `vi.spyOn`/assignment/`defineProperty` on the frozen `[object Module]`
 * namespace all fail to patch it — silently leaving any pin built on them
 * unfalsifiable. Same technique and same reason as
 * `plugin-list/src/__tests__/ListView.discardedExpandFieldsMemo.test.tsx`
 * (objectui#6697).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as ReactNS from 'react';
import type { FieldLevelPermission } from '@object-ui/types';
import { PermCtx, type PermissionContextValue } from '../PermissionContext';
import { usePermissions } from '../usePermissions';

const memoProxy = vi.hoisted(() => ({ markers: [] as unknown[], epoch: 0 }));

vi.mock('react', async (importOriginal) => {
  // `<any>` matches the sibling pins (objectui#6697) and is load-bearing: a
  // precise module type makes `realUseMemo`'s deps parameter `DependencyList`,
  // which the patched signature below cannot satisfy.
  const actual = await importOriginal<any>();
  const realUseMemo = actual.useMemo;
  const patched = (factory: () => unknown, deps?: unknown[]) =>
    Array.isArray(deps) && deps.some((d) => memoProxy.markers.includes(d))
      ? realUseMemo(factory, [...deps, memoProxy.epoch])
      : realUseMemo(factory, deps);
  return { ...actual, useMemo: patched, default: { ...(actual.default ?? actual), useMemo: patched } };
});

/** Put memos whose deps name one of `markers` under this file's control. */
function armDiscardProxy(markers: unknown[]): () => void {
  memoProxy.markers = markers;
  return () => {
    memoProxy.markers = [];
  };
}
/** Throw away the armed memos' caches — one discard event, on demand. */
function discardNow(): void {
  memoProxy.epoch += 1;
}

/**
 * The marker for the provider case: the context VALUE itself, which is the
 * hook's only memo dependency. Held as a module constant so its IDENTITY is
 * what the proxy matches, and so a real `PermissionProvider` (whose own
 * `value` memo is a separate link in this chain — see the header) is not in
 * the way of what this file measures.
 */
const SECRET_FIELD_PERMISSION: FieldLevelPermission = {
  field: 'secret',
  read: false,
  write: false,
};

const CTX: PermissionContextValue = {
  check: (object, action) => ({ allowed: !(object === 'locked' && action === 'update') }),
  checkField: (_object, field) => field !== 'secret',
  getFieldPermissions: () => [SECRET_FIELD_PERMISSION],
  getRowFilter: (object) => (object === 'accounts' ? 'owner_id = me' : undefined),
  getObjectApiOperations: () => ['find', 'update'],
  roles: ['admin'],
  userId: 'u-1',
  systemPermissions: ['manage_app'],
  hasCapabilities: (required) => required.every((c) => c === 'manage_app'),
  isLoaded: true,
};

/** A second, DIFFERENT context — a genuine change the hook must still see. */
const CTX_B: PermissionContextValue = {
  ...CTX,
  checkField: () => false,
  roles: ['viewer'],
  userId: 'u-2',
};

type Perms = ReturnType<typeof usePermissions>;

/** Records every value the hook returns, plus each run of an effect keyed on it. */
function makeProbe() {
  const seen: Perms[] = [];
  const effectRuns: Perms[] = [];
  const Probe: React.FC = () => {
    const perms = usePermissions();
    seen.push(perms);
    // Exactly the consumer shape this card is about: `ListView`'s data-fetch
    // effect names the whole object in its dependency array.
    ReactNS.useEffect(() => {
      effectRuns.push(perms);
    }, [perms]);
    return null;
  };
  return { seen, effectRuns, Probe };
}

afterEach(() => {
  cleanup();
  memoProxy.markers = [];
});

describe('usePermissions — the returned identity survives a discarded memo cache (objectui#6724)', () => {
  it('provesTheProxyDiscriminates: the proxy reaches the same React binding the hook uses', () => {
    const MARKER = 'canary-marker';
    const seen: unknown[] = [];
    const Probe: React.FC = () => {
      seen.push(ReactNS.useMemo(() => ({}), [MARKER]));
      return null;
    };

    const restore = armDiscardProxy([MARKER]);
    try {
      const { rerender } = render(<Probe />);
      // Armed but not fired: normal caching still holds.
      rerender(<Probe />);
      expect(seen[1]).toBe(seen[0]);

      discardNow();
      rerender(<Probe />);
    } finally {
      restore();
    }
    expect(seen[2]).not.toBe(seen[1]);
  });

  it('keeps ONE identity across a discard while `ctx` is unchanged (provider mounted)', () => {
    const { seen, effectRuns, Probe } = makeProbe();
    const tree = () => (
      <PermCtx.Provider value={CTX}>
        <Probe />
      </PermCtx.Provider>
    );

    const restore = armDiscardProxy([CTX]);
    try {
      const { rerender } = render(tree());
      rerender(tree());
      expect(new Set(seen).size).toBe(1);

      // One discard, then a re-render with the SAME context value. Nothing an
      // author or a caller controls has changed.
      discardNow();
      rerender(tree());
    } finally {
      restore();
    }

    expect(new Set(seen).size).toBe(1);
    // The observable the card names, modelled at its source: the consuming
    // effect must not re-run.
    expect(effectRuns).toHaveLength(1);
  });

  it('keeps ONE identity across a discard with NO provider mounted', () => {
    const { seen, effectRuns, Probe } = makeProbe();

    // With no provider the hook's only memo dependency WAS `ctx === null`, so
    // `null` is the marker that reaches it. Nothing else in this tree memoises
    // on `null` — the probe is the whole tree.
    const restore = armDiscardProxy([null]);
    try {
      const { rerender } = render(<Probe />);
      rerender(<Probe />);
      expect(new Set(seen).size).toBe(1);

      discardNow();
      rerender(<Probe />);
    } finally {
      restore();
    }

    expect(new Set(seen).size).toBe(1);
    expect(effectRuns).toHaveLength(1);
  });

  it('still hands back a NEW identity when the context value genuinely changes', () => {
    const { seen, effectRuns, Probe } = makeProbe();
    const tree = (ctx: PermissionContextValue) => (
      <PermCtx.Provider value={ctx}>
        <Probe />
      </PermCtx.Provider>
    );

    const { rerender } = render(tree(CTX));
    rerender(tree(CTX_B));

    expect(seen[seen.length - 1]).not.toBe(seen[0]);
    expect(effectRuns).toHaveLength(2);
    // …and the new identity carries the NEW answers, not a stale snapshot.
    expect(seen[0].checkField('accounts', 'name', 'read')).toBe(true);
    expect(seen[seen.length - 1].checkField('accounts', 'name', 'read')).toBe(false);
    expect(seen[seen.length - 1].userId).toBe('u-2');
  });
});

describe('usePermissions — the permission VALUES are untouched by the identity fix (objectui#6724)', () => {
  /** Every answer, read off one render, asserted against `CTX` itself. */
  const readAll = (p: Perms) => ({
    checkAllowed: p.check('accounts', 'update').allowed,
    checkDenied: p.check('locked', 'update').allowed,
    checkFieldOpen: p.checkField('accounts', 'name', 'read'),
    checkFieldDenied: p.checkField('accounts', 'secret', 'read'),
    fieldPerms: p.getFieldPermissions('accounts'),
    rowFilter: p.getRowFilter('accounts'),
    rowFilterNone: p.getRowFilter('contacts'),
    apiOps: p.getObjectApiOperations('accounts'),
    roles: p.roles,
    userId: p.userId,
    systemPermissions: p.systemPermissions,
    capHeld: p.hasCapabilities(['manage_app']),
    capMissing: p.hasCapabilities(['manage_billing']),
    isLoaded: p.isLoaded,
    can: p.can('accounts', 'update'),
    canDenied: p.can('locked', 'update'),
    cannot: p.cannot('locked', 'update'),
    cannotAllowed: p.cannot('accounts', 'update'),
  });

  it('answers exactly what the context answers — before AND after a discard', () => {
    const { seen, Probe } = makeProbe();
    const tree = () => (
      <PermCtx.Provider value={CTX}>
        <Probe />
      </PermCtx.Provider>
    );

    const restore = armDiscardProxy([CTX]);
    let after: Perms;
    try {
      const { rerender } = render(tree());
      discardNow();
      rerender(tree());
      after = seen[seen.length - 1];
    } finally {
      restore();
    }

    const expected = {
      checkAllowed: true,
      checkDenied: false,
      checkFieldOpen: true,
      checkFieldDenied: false,
      fieldPerms: [SECRET_FIELD_PERMISSION],
      rowFilter: 'owner_id = me',
      rowFilterNone: undefined,
      apiOps: ['find', 'update'],
      roles: ['admin'],
      userId: 'u-1',
      systemPermissions: ['manage_app'],
      capHeld: true,
      capMissing: false,
      isLoaded: true,
      // `can`/`cannot` are derived from `check`, and must stay derived.
      can: true,
      canDenied: false,
      cannot: true,
      cannotAllowed: false,
    };
    expect(readAll(seen[0])).toEqual(expected);
    expect(readAll(after)).toEqual(expected);
    // Every member the context itself defines is passed through by identity —
    // the spread is intact, not re-implemented.
    expect(after.check).toBe(CTX.check);
    expect(after.checkField).toBe(CTX.checkField);
    expect(after.getFieldPermissions).toBe(CTX.getFieldPermissions);
    expect(after.getRowFilter).toBe(CTX.getRowFilter);
    expect(after.getObjectApiOperations).toBe(CTX.getObjectApiOperations);
    expect(after.hasCapabilities).toBe(CTX.hasCapabilities);
    expect(after.roles).toBe(CTX.roles);
  });

  it('keeps the documented no-provider fallback answers, and shares ONE frozen object', () => {
    const { seen: seenA, Probe: ProbeA } = makeProbe();
    const { seen: seenB, Probe: ProbeB } = makeProbe();
    render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );
    const p = seenA[0];

    expect(p.isLoaded).toBe(false);
    expect(p.check('accounts', 'update')).toEqual({ allowed: true });
    expect(p.checkField('accounts', 'secret', 'read')).toBe(true);
    expect(p.getFieldPermissions('accounts')).toEqual([]);
    expect(p.getRowFilter('accounts')).toBeUndefined();
    expect(p.getObjectApiOperations('accounts')).toBeUndefined();
    expect(p.roles).toEqual([]);
    // [objectui#5683] identity unknown, not "anonymous".
    expect(p.userId).toBeNull();
    // [objectui#4656] unreported, NOT a reported-empty grant — and
    // `hasCapabilities` stays fail-open on it.
    expect(p.systemPermissions).toBeUndefined();
    expect(p.hasCapabilities(['manage_app'])).toBe(true);
    expect(p.can('accounts', 'update')).toBe(true);
    expect(p.cannot('accounts', 'update')).toBe(false);

    // One shared answer, and frozen: it is no longer a per-call literal, so a
    // consumer must not be able to mutate everyone else's copy.
    expect(seenB[0]).toBe(p);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.roles)).toBe(true);
  });

  it('hands the SAME identity to two components reading the same context value', () => {
    const { seen: seenA, Probe: ProbeA } = makeProbe();
    const { seen: seenB, Probe: ProbeB } = makeProbe();
    render(
      <PermCtx.Provider value={CTX}>
        <ProbeA />
        <ProbeB />
      </PermCtx.Provider>,
    );
    // One decorated object per context value, not per component instance —
    // stronger than the per-instance memo it replaces, and the property that
    // makes the identity a function of the permissions themselves.
    expect(seenB[0]).toBe(seenA[0]);
    expect(seenA[0].can('accounts', 'update')).toBe(true);
    expect(seenB[0].can('locked', 'update')).toBe(false);
  });
});
