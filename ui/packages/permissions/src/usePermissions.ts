/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useContext } from 'react';
import type { PermissionAction, PermissionCheckResult } from '@object-ui/types';
import { PermCtx, type PermissionContextValue } from './PermissionContext.js';

/** What `usePermissions()` hands back: the context plus the two conveniences. */
type PermissionsWithHelpers = PermissionContextValue & {
  /** Convenience: check if action is allowed */
  can: (object: string, action: PermissionAction) => boolean;
  /** Convenience: check if action is denied */
  cannot: (object: string, action: PermissionAction) => boolean;
};

/** Shared, frozen: the no-provider answer holds no roles and nobody may add one. */
const NO_ROLES = Object.freeze([]) as unknown as string[];

/**
 * [objectui#6724] The no-provider answer, as ONE module-level object rather
 * than a fresh literal per call. Every member is a pure constant function, so
 * there is nothing per-instance to keep — and a single frozen object is the
 * strongest identity guarantee available: it cannot churn for any reason, in
 * any component, ever. Frozen because it is now shared: a consumer that
 * mutated its own copy used to affect only itself.
 */
const NO_PROVIDER_PERMISSIONS: PermissionsWithHelpers = Object.freeze({
  check: (): PermissionCheckResult => ({ allowed: true }),
  checkField: () => true,
  getFieldPermissions: () => [],
  getRowFilter: () => undefined,
  getObjectApiOperations: () => undefined,
  roles: NO_ROLES,
  // [objectui#5683] No provider → identity unknown, defer to the server.
  userId: null,
  // [objectui#4656] No provider mounted at all → no answer, not "holds
  // nothing". `undefined` matches MePermissionsProvider's own signal
  // for an unreported backend and keeps `hasCapabilities` fail-open.
  systemPermissions: undefined,
  hasCapabilities: () => true,
  isLoaded: false,
  can: () => true,
  cannot: () => false,
});

/**
 * [objectui#6724] One decorated object per context value, for the life of that
 * context value. A `WeakMap` keyed on `ctx` holds the entry only as long as
 * the provider's own value is reachable, so nothing here outlives the render
 * tree that produced it.
 */
const DECORATED = new WeakMap<PermissionContextValue, PermissionsWithHelpers>();

function withHelpers(ctx: PermissionContextValue): PermissionsWithHelpers {
  const cached = DECORATED.get(ctx);
  if (cached) return cached;
  const decorated: PermissionsWithHelpers = {
    ...ctx,
    can: (object: string, action: PermissionAction) => ctx.check(object, action).allowed,
    cannot: (object: string, action: PermissionAction) => !ctx.check(object, action).allowed,
  };
  DECORATED.set(ctx, decorated);
  return decorated;
}

/**
 * Hook to access the permission system.
 * Must be used within a PermissionProvider.
 *
 * ## Why the identity is cached outside React, not in a `useMemo`
 *
 * Consumers put this hook's return value straight into dependency arrays —
 * `ListView`'s data-fetch effect (`perms`), `DetailView`'s `gatedSchema` memo,
 * `ObjectForm`, `ModalForm`, `ObjectGrid`, `RelatedList` (13 arrays across 6
 * files). Without a cache those deps see a fresh object every render and
 * re-fire on every render; that is the infinite-update loop this cache has
 * always existed to stop.
 *
 * It used to be a `useMemo` keyed on `[ctx]`, and that is the wrong tool for a
 * dependency other code's CORRECTNESS rests on (objectui#6724, the family of
 * #6018 / #5976 / #6591 / #6592 / #6697). `useMemo` is a pure optimisation
 * carrying no semantic guarantee: React is permitted to discard the cache and
 * recompute even when `[ctx]` compares equal, and BOTH branches build a fresh
 * object — an object literal with no provider, a spread of `ctx` with one. A
 * discard therefore moved the identity while every permission it carries
 * stayed the same, and the consuming fetch effect re-ran: an extra
 * `dataSource.find` with nothing an author or a caller controls having
 * changed.
 *
 * What replaces it is not another React cache but a plain function of `ctx`:
 * the same context value always yields the same decorated object, because the
 * mapping lives in a module-level `WeakMap` React has no say over. That is
 * strictly stronger than the memo it replaces — the identity is now stable
 * across every component reading the same provider, not just across one
 * component's re-renders — and it costs no hook, so there is no render-phase
 * ref write and no state adjustment to reason about (objectui#6745 / #6797
 * are open on exactly that smell in published hooks).
 *
 * ⚠️ The guarantee is "one identity per context value" — which is what the
 * consumers need, since what they read off this object is the VERDICT
 * FUNCTIONS (`checkField(object, field, 'read')`, `can(object, 'update')`)
 * over an open set of field names. There is no fixed list of primitives those
 * flatten to, so the by-identity dependency at the consumers is the correct
 * shape and stays; this hook is where the identity is made trustworthy. A new
 * context value still produces a new identity, on purpose: that is a real
 * permission change and every consumer must see it. The providers' own
 * context-value memos are the remaining link in that chain and are not
 * addressed here (objectui#6813).
 */
export function usePermissions(): PermissionsWithHelpers {
  const ctx = useContext(PermCtx);
  return ctx ? withHelpers(ctx) : NO_PROVIDER_PERMISSIONS;
}
