/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  HttpFetchError,
  backoffMs,
  isTransientFailure,
  retryAfterFrom,
  sleep,
} from '@object-ui/types';
import type {
  PermissionAction,
  PermissionCheckResult,
  FieldLevelPermission,
} from '@object-ui/types';
import { objectPermissionGrants } from '@objectstack/spec/security';
import { SystemFieldName } from '@objectstack/spec/system';
import { PermCtx, type PermissionContextValue } from './PermissionContext.js';
import { createDiscardProofCache } from './discardProofCache.js';

/**
 * Shape of the upstream `/api/v1/auth/me/permissions` response.
 * See framework/packages/plugins/plugin-hono-server.
 */
export interface MePermissionsResponse {
  authenticated: boolean;
  userId: string | null;
  tenantId: string | null;
  roles: string[];
  permissionSets: string[];
  /** [ADR-0066] System capabilities (union of permission-set systemPermissions): manage_users, setup.access, … */
  systemPermissions?: string[];
  /** object-level perms: { "*": {...}, "account": {...} } */
  objects: Record<string, {
    allowCreate?: boolean;
    allowRead?: boolean;
    allowEdit?: boolean;
    allowDelete?: boolean;
    viewAllRecords?: boolean;
    modifyAllRecords?: boolean;
    /**
     * The transfer grant: may the caller change a record's owner. The server
     * refuses an update that writes the owner field without it (or without
     * `modifyAllRecords`, which implies it), and `checkField` reads it for that
     * field's `write` question (objectui#12103).
     */
    allowTransfer?: boolean;
    /**
     * [objectstack#3391] Server-resolved effective API operation set for this object
     * (enum-ordered). Present only when the object tightens exposure via
     * `apiMethods`; absent = unrestricted (client default-allow). The frontend
     * consumes THIS, never a raw `apiMethods` whitelist.
     */
    apiOperations?: string[];
    [k: string]: unknown;
  }>;
  /** field-level perms keyed `"object.field"` */
  fields: Record<string, { readable?: boolean; editable?: boolean }>;
}

export interface MePermissionsProviderProps {
  /** Absolute or relative URL to the /me/permissions endpoint */
  endpoint?: string;
  /**
   * Fetch implementation used to call the endpoint. Pass an authenticated
   * fetch (e.g. `createAuthenticatedFetch()` from `@object-ui/auth`) so the
   * request carries the Bearer token: with the default global `fetch` the
   * request is cookie-only, and a token-only session (localStorage, no
   * better-auth cookie) resolves as anonymous — the UI then renders
   * restricted fields as editable (objectstack-ai/objectstack#2926 ④).
   */
  fetcher?: typeof fetch;
  /** Pre-fetched permissions payload (testing / SSR) */
  initialPermissions?: MePermissionsResponse;
  /** Rendered while permissions load (fail-closed) */
  loadingFallback?: React.ReactNode;
  /** Rendered when load fails */
  errorFallback?: (err: Error, retry: () => void) => React.ReactNode;
  /**
   * How many times to re-attempt a TRANSIENT failure before giving up — a
   * response that says "not now" (`TRANSIENT_STATUS` in `@object-ui/types`) or a network
   * error. `0` disables retrying.
   *
   * This exists because "not now" is a real answer from this endpoint. On a
   * multi-tenant host it is served by the environment kernel that owns the
   * session, and a cold one answers `503` + `Retry-After` while it warms
   * (objectstack#4159). Without a retry the provider keeps `loadingFallback`
   * on screen forever, because a consumer that passes no `errorFallback` — the
   * console does exactly that — renders the loading node for the error state
   * too, and nothing ever calls `retry`.
   *
   * @default 3
   */
  maxRetries?: number;
  /**
   * Base for the exponential backoff between retries, in ms. A `Retry-After`
   * header on the response wins over it. @default 500
   */
  retryBaseDelayMs?: number;
  /** Children */
  children: React.ReactNode;
}

const DEFAULT_ENDPOINT = '/api/v1/auth/me/permissions';

/**
 * [objectui#6813] One cache per cached thing, each keyed on exactly the inputs
 * that thing is derived from — the same sets the `useCallback`/`useMemo`
 * dependency arrays named before, so nothing churns more often than it did.
 * What changes is that React can no longer discard them: a discard used to
 * hand `PermCtx.Provider` a NEW value with every permission it carries
 * unchanged, which moves the key `usePermissions()` caches on (objectui#6724)
 * and re-runs every consumer effect downstream. See `discardProofCache.ts` for
 * why this is a module-level `WeakMap` and not a `useMemo` or a `useRef`.
 */
const CHECK = createDiscardProofCache<PermissionContextValue['check']>();
const CHECK_FIELD = createDiscardProofCache<PermissionContextValue['checkField']>();
const GET_FIELD_PERMISSIONS = createDiscardProofCache<PermissionContextValue['getFieldPermissions']>();
const GET_OBJECT_API_OPERATIONS = createDiscardProofCache<PermissionContextValue['getObjectApiOperations']>();
const VALUE = createDiscardProofCache<PermissionContextValue>();

/**
 * Stands in for `data === null`, which cannot key a `WeakMap`. With no data
 * every member answers its fail-closed constant and `isLoaded` is false, so
 * this sentinel names exactly one reachable value rather than a family of them.
 */
const NO_DATA: object = { data: 'unloaded' };

/**
 * `isLoaded` is a boolean and cannot key a `WeakMap` either. Its domain has two
 * members, so two module-level sentinels cover it totally — no coercion, no
 * collision. It is the ONLY thing `loading` and `error` contribute to the
 * context value, so keying on it directly (rather than on `[data, loading,
 * error]`) also stops a new `Error` identity from churning a value that reads
 * the same to every consumer.
 */
const LOADED: object = { isLoaded: true };
const NOT_LOADED: object = { isLoaded: false };

/**
 * The row filter this provider can offer for any object: none. `/me/permissions`
 * carries no row-level filter, so this is a constant for every object and every
 * provider instance — module-level, which is strictly stabler than the
 * `useCallback(..., [])` it replaces, since React may discard that one.
 */
const NO_ROW_FILTER: PermissionContextValue['getRowFilter'] = () => undefined;

/**
 * [objectui#6862] The four inputs a fetch is derived from, named once so the
 * effect below and `retry` cannot drift apart on what "the fetch changed" means.
 */
interface FetchConfig {
  endpoint: string;
  fetcher: typeof fetch | undefined;
  maxRetries: number;
  retryBaseDelayMs: number;
}

/**
 * Where a completed attempt reports. Every member is a `useState` setter, whose
 * identity React DOES guarantee — unlike `useMemo`/`useCallback`, which is the
 * whole point of moving this function out of the component in the first place.
 */
interface FetchSink {
  setData: (data: MePermissionsResponse) => void;
  setError: (error: Error | null) => void;
  setLoading: (loading: boolean) => void;
}

/**
 * Run the fetch, re-attempting a transient failure.
 *
 * `token` cancels an in-flight attempt. Retries put real time (a backoff, or
 * a server-stated `Retry-After`) between the request and the `setState`, and
 * during that window the effect may be torn down — by an unmount, or by
 * `endpoint`/`fetcher` changing. Without the token a superseded attempt would
 * still land, so a slow answer for the OLD endpoint could overwrite a fast
 * answer for the new one.
 *
 * [objectui#6862] This is a module-level function rather than the `useCallback`
 * it used to be. A `useCallback` carries no semantic guarantee: React may
 * discard the cache and rebuild even when the dependency list compares equal,
 * and the rebuilt function is a NEW identity. The fetch effect named that
 * identity as its dependency, so a discard tore the effect down and re-ran it
 * with none of the four inputs changed — a redundant
 * `/api/v1/auth/me/permissions` round trip on the provider that gates the whole
 * console. Nothing here closes over render scope, so there is no identity left
 * for React to move: the effect keys on the four VALUES instead.
 */
async function loadPermissions(
  { endpoint, fetcher, maxRetries, retryBaseDelayMs }: FetchConfig,
  { setData, setError, setLoading }: FetchSink,
  token?: { cancelled: boolean },
): Promise<void> {
  const live = () => !token?.cancelled;
  setLoading(true);
  setError(null);
  const doFetch = fetcher ?? fetch;
  const attempts = Math.max(0, maxRetries) + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await doFetch(endpoint, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new HttpFetchError(
          res.status,
          retryAfterFrom(res),
          `Permissions endpoint returned ${res.status}`,
        );
      }
      const json = (await res.json()) as MePermissionsResponse;
      if (!live()) return;
      setData(json);
      setLoading(false);
      return;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (!isTransientFailure(err) || attempt === attempts - 1) {
        if (!live()) return;
        setError(err);
        setLoading(false);
        return;
      }
      // `loading` stays true across the wait, so the fail-closed loading
      // state holds and the recovery is invisible to consumers.
      const stated = err instanceof HttpFetchError ? err.retryAfterMs : undefined;
      await sleep(backoffMs(attempt, retryBaseDelayMs, stated));
      if (!live()) return;
    }
  }
}

/**
 * MePermissionsProvider
 *
 * Fetches the current user's effective permissions from the framework's
 * `/me/permissions` endpoint and exposes them through the shared
 * `PermCtx` so that all existing `usePermissions` / `useFieldPermissions`
 * consumers transparently get server-driven field-level gating.
 *
 * Fail-closed: while loading, renders `loadingFallback` (default: null)
 * so consumers never see "permitted" state before the data arrives.
 */
export function MePermissionsProvider({
  endpoint = DEFAULT_ENDPOINT,
  fetcher,
  initialPermissions,
  loadingFallback = null,
  errorFallback,
  maxRetries = 3,
  retryBaseDelayMs = 500,
  children,
}: MePermissionsProviderProps) {
  const [data, setData] = useState<MePermissionsResponse | null>(initialPermissions ?? null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!initialPermissions);

  /**
   * [objectui#6862] Keyed on the four VALUES the fetch is derived from, never
   * on a memoised driver's identity. React may discard a `useMemo`/`useCallback`
   * cache even when its dependency list compares equal, and this effect used to
   * name such a callback — so a discard cost a redundant round trip with nothing
   * an author or a caller controls having changed.
   *
   * The trigger set is unchanged: these are exactly the four the old callback
   * listed, so every legitimate refetch still happens (pinned in
   * `providerCtxIdentity.discarded.test.tsx`). What is gone is React's licence
   * to re-run this effect on its own. Merely DROPPING the dependency would also
   * have stopped the redundant trip — and would have stopped the legitimate ones
   * with it.
   */
  useEffect(() => {
    if (initialPermissions) return;
    const token = { cancelled: false };
    void loadPermissions(
      { endpoint, fetcher, maxRetries, retryBaseDelayMs },
      { setData, setError, setLoading },
      token,
    );
    return () => { token.cancelled = true; };
  }, [endpoint, fetcher, maxRetries, retryBaseDelayMs, initialPermissions]);

  /**
   * The `retry` handed to `errorFallback` — uncancelled, it is user-initiated.
   *
   * This one may stay a `useCallback`: nothing keys on its identity. It is
   * passed to a render prop, so a discard rebuilds a function and costs a
   * re-render of the error fallback — never a round trip, which is what the
   * effect above was paying.
   */
  const retry = useCallback(
    () => {
      void loadPermissions(
        { endpoint, fetcher, maxRetries, retryBaseDelayMs },
        { setData, setError, setLoading },
      );
    },
    [endpoint, fetcher, maxRetries, retryBaseDelayMs],
  );

  const dataKey: object = data ?? NO_DATA;

  const checkField = CHECK_FIELD([dataKey], () =>
    (object: string, field: string, action: 'read' | 'write' | 'create'): boolean => {
      if (!data) return false; // fail-closed
      // Normalize casing — backend stores keys lowercase but callers may
      // pass schema.objectName as "Account" / "account" interchangeably.
      const objKey = (object ?? '').toLowerCase();
      const key = `${objKey}.${field}`;
      const fieldPerm = data.fields?.[key] ?? data.fields?.[`${object}.${field}`];
      const objPerm = data.objects?.[objKey] ?? data.objects?.[object] ?? data.objects?.['*'];
      // [objectui#12103] An update that writes the record's OWNER is a
      // transfer: the server's security step refuses it unless the caller holds
      // the transfer grant, whatever the field's own entry says. So `write` for
      // that field needs the grant too, read with the spec's own predicate
      // (`allowTransfer`, or `modifyAllRecords`, which implies it). The field is
      // the one the spec names, as the server's guard keys it. `create` is not
      // narrowed: on insert the server stamps an empty owner to the caller and
      // accepts the caller's own id. An object the answer does not mention
      // takes the unknown-object default below.
      if (
        action === 'write' &&
        field === SystemFieldName.OWNER_ID &&
        !(objPerm ? objectPermissionGrants(objPerm, 'allowTransfer') : data.authenticated !== true)
      ) {
        return false;
      }
      // An explicit entry answers `write` and `create` alike: the server's
      // field step refuses a non-editable field on insert and update both.
      if (fieldPerm) {
        return action === 'read'
          ? fieldPerm.readable !== false
          : fieldPerm.editable !== false;
      }
      // No explicit field-level override → defer to object-level perms: the
      // field step lets the field through and object admission decides, so
      // the answer is the grant of the operation asked about (objectui#12082)
      // — `allowCreate` on an insert, `allowEdit` on an update.
      if (!objPerm) {
        // [objectstack-ai/objectstack#2926 ④] Unknown-object default is authentication-gated:
        //  - authenticated session → fail-CLOSED. The server resolved this
        //    user's permissions and said nothing about the object, so
        //    rendering it editable invites input the data layer will strip.
        //  - anonymous (`authenticated: false` — the endpoint's no-session
        //    200 carries no objects/fields at all) → keep the permissive
        //    default. Guest/public surfaces have no resolvable perms by
        //    design; the server still enforces, and locking every field
        //    would brick public forms.
        return data.authenticated !== true;
      }
      if (action === 'read') return objPerm.allowRead !== false;
      return action === 'create'
        ? objPerm.allowCreate !== false
        : objPerm.allowEdit !== false;
    },
  );

  const check = CHECK([dataKey], () =>
    (object: string, action: PermissionAction): PermissionCheckResult => {
      if (!data) return { allowed: false, reason: 'permissions-loading' };
      const objPerm = data.objects?.[object] ?? data.objects?.['*'];
      const map: Record<string, keyof NonNullable<typeof objPerm>> = {
        read: 'allowRead',
        view: 'allowRead',
        create: 'allowCreate',
        update: 'allowEdit',
        edit: 'allowEdit',
        delete: 'allowDelete',
        // [objectstack#3391] import derives from create∨update, export from list(read) —
        // gate them on the base write/read permission bit (the per-object
        // effective API operation set adds the finer apiMethods layer on top,
        // consumed via getObjectApiOperations + resolveCrudAffordances).
        import: 'allowCreate',
        export: 'allowRead',
      };
      const k = map[action as string] ?? 'allowRead';
      // Same authentication-gated default as checkField (objectstack-ai/objectstack#2926 ④).
      const allowed = objPerm ? (objPerm as any)[k] !== false : data.authenticated !== true;
      return { allowed, reason: allowed ? undefined : 'denied-by-permission-set' };
    },
  );

  const getFieldPermissions = GET_FIELD_PERMISSIONS([dataKey], () =>
    (object: string): FieldLevelPermission[] => {
      if (!data) return [];
      const prefix = `${object}.`;
      const out: FieldLevelPermission[] = [];
      for (const [key, value] of Object.entries(data.fields ?? {})) {
        if (!key.startsWith(prefix)) continue;
        const field = key.slice(prefix.length);
        out.push({
          field,
          read: value.readable !== false,
          write: value.editable !== false,
        });
      }
      return out;
    },
  );

  const getObjectApiOperations = GET_OBJECT_API_OPERATIONS([dataKey], () =>
    (object: string): string[] | undefined => {
      if (!data) return undefined;
      const objKey = (object ?? '').toLowerCase();
      // Per-object only — the `*` wildcard carries no apiOperations. Absent →
      // undefined so consumers fall back to their current (default-allow) path.
      const objPerm = data.objects?.[objKey] ?? data.objects?.[object];
      const ops = objPerm?.apiOperations;
      return Array.isArray(ops) ? ops : undefined;
    },
  );

  const isLoaded = !loading && !error && data !== null;

  // Keyed on the union of what the members above are keyed on, so this value is
  // rebuilt exactly when one of them is and never captures a stale member.
  const value = VALUE([dataKey, isLoaded ? LOADED : NOT_LOADED], () => ({
    check,
    checkField,
    getFieldPermissions,
    getRowFilter: NO_ROW_FILTER,
    getObjectApiOperations,
    roles: data?.roles ?? [],
    // [objectui#5683] `null` while unloaded/anonymous — never ''. Consumers
    // treat null as "unknown" and defer to the server.
    userId: data?.userId ?? null,
    // [objectui#4656] Forward the raw signal — do NOT `?? []` this. A
    // backend predating ADR-0066 omits `systemPermissions` from the
    // response entirely, and defaulting that to `[]` here made it
    // indistinguishable from a genuinely empty grant to every consumer
    // downstream (this provider's own `hasCapabilities` included).
    systemPermissions: data?.systemPermissions,
    hasCapabilities: (required: string[]) => {
      const perms = data?.systemPermissions;
      // Unknown (backend never reported systemPermissions) fails OPEN — see
      // the doctrine on `PermissionContextValue.hasCapabilities`.
      if (!Array.isArray(perms)) return true;
      const held = new Set(perms);
      return required.every((p) => held.has(p));
    },
    // [objectui#4421] The response's `objects` map, verbatim — the data
    // `current_user.can(object, verb)` is answered from. Keyed on `dataKey`
    // like every member here, so it is the SAME object for the same payload.
    effectiveObjects: data?.objects,
    isLoaded,
  }));

  if (loading && !data) return <>{loadingFallback}</>;
  if (error && !data) {
    if (errorFallback) return <>{errorFallback(error, retry)}</>;
    return <>{loadingFallback}</>;
  }

  return <PermCtx.Provider value={value}>{children}</PermCtx.Provider>;
}
