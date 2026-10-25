/**
 * useEnvironmentEntitlements — resolve the org's environment-capacity state so
 * the `sys_environment` list can present the right "create" affordance up front.
 *
 * Two signals, in priority order:
 *   1. AUTHORITATIVE — GET /cloud/environment-entitlements (org-scoped, computed
 *      by the same helper the create guard uses). Gives plan + dev-create
 *      capability precisely, including the seat-scaled / subscription cases the
 *      client can't derive from rows.
 *   2. FALLBACK — when that endpoint is unavailable (older control plane / error,
 *      or a success body that doesn't carry the `{ success, data }` envelope),
 *      derive `hasProductionEnv` from the org's env rows via the data API (which
 *      is org-scoped on the control plane). This keeps the critical
 *      "set up your production environment" path working without a backend deploy;
 *      free-vs-paid is left unknown, and a stray create POST is caught by the
 *      entitlement dialog safety net.
 *
 * Returns `null` when disabled (not the environment list) so callers can cheaply
 * branch. Re-resolves when `refreshKey` changes (e.g. after a create).
 *
 * ## One request per organisation, however many readers (objectui#12808)
 *
 * Every reader of this hook shares ONE resource per (control-plane origin,
 * organisation): the in-flight resolution and its settled answer. When this
 * landed, the Cloud pricing page mounted one `cloud:plan-status` per plan card
 * and the Welcome page mounted `cloud:onboarding-next` beside
 * `cloud:workspace-timezone-notice` (the first two have since retired,
 * objectui#12954); each used to issue its own GET, and Chrome serialises
 * identical in-flight GETs, so three cards paid three round trips in series.
 *
 * Freshness is unchanged, because nothing here is time-based:
 *   - the answer is held only while at least one reader is mounted. When the
 *     last one unmounts the resource is dropped, so a later mount asks the
 *     server again, exactly as every mount did before;
 *   - a different organisation is a different resource;
 *   - a reader whose `refreshKey` changes (the environment list after a create)
 *     re-resolves the shared resource, and every reader receives the new answer.
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@object-ui/auth';
import type { EnvironmentEntitlementsState, EnvironmentEntitlementsSummary } from './entitlements.js';

const TERMINAL_STATUSES = new Set(['archived', 'failed']);

/** Mirror of the server `classifyEnvironmentType`: explicit type, else default→prod. */
function classifyEnvironmentType(row: any): 'production' | 'development' {
  const t = String(row?.environment_type ?? '').trim().toLowerCase();
  if (t === 'production' || t === 'prod') return 'production';
  if (t) return 'development';
  return row?.is_default === true || row?.is_default === 1 ? 'production' : 'development';
}

export interface UseEnvironmentEntitlementsOptions {
  /** Only fetch when this is the environment list (objectName === 'sys_environment'). */
  enabled: boolean;
  dataSource: any;
  /** Authenticated fetch (Bearer + tenant + cookies) — from the action runtime. */
  authFetch: (url: string, init?: any) => Promise<Response>;
  /** Control-plane origin (VITE_SERVER_URL); '' in same-origin production. */
  apiBase: string;
  /** Bump to re-resolve (e.g. the list's refreshKey after a successful create). */
  refreshKey?: unknown;
}

type EntitlementsResolveOptions = Pick<UseEnvironmentEntitlementsOptions, 'dataSource' | 'authFetch' | 'apiBase'> & {
  orgId: string | undefined;
};

/** The authoritative summary first, the row derivation when it is unavailable. */
async function resolveEntitlements(opts: EntitlementsResolveOptions): Promise<EnvironmentEntitlementsState> {
  const { dataSource, authFetch, apiBase, orgId } = opts;

  const fromSummary = async (): Promise<EnvironmentEntitlementsState | null> => {
    try {
      const base = (apiBase || '').replace(/\/+$/, '');
      const qs = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : '';
      const res = await authFetch(`${base}/api/v1/cloud/environment-entitlements${qs}`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) return null;
      // Strict envelope read: the control plane wraps every success body as
      // `{ success, data }` (cloud#1046), and `EnvironmentEntitlementsSummary`
      // is declared as that `data` payload. A bare body is therefore a
      // producer contract violation, not a second accepted dialect — reading
      // it would yield a summary whose fields are all `undefined`, i.e. a
      // silent `hasProductionEnv: false`. Returning null instead degrades to
      // the `fromRows()` derivation, which resolves that signal for real.
      const json = (await res.json().catch(() => null)) as
        | { data?: EnvironmentEntitlementsSummary }
        | null;
      const data = json?.data;
      if (!data || typeof data !== 'object') return null;
      return {
        ready: true,
        hasProductionEnv: data.hasProductionEnv === true,
        canCreateDevelopmentEnv: data.development?.canCreate,
        plan: data.plan,
        // Verbatim, like `contactSalesUrl`: absent stays absent, and the
        // toolbar's locked plan-tier mark is then not drawn (objectui#10437,
        // objectui#12983: cloud sends it to managers only).
        upgradeUrl: data.upgradeUrl,
        contactSalesUrl: data.contactSalesUrl,
        // Verbatim, like `upgradeUrl`: absent stays absent, and the
        // workspace-timezone notice then renders nothing (objectui#11930).
        workspaceTimezoneSeed: data.workspaceTimezoneSeed,
        source: 'summary',
      };
    } catch {
      return null;
    }
  };

  const fromRows = async (): Promise<EnvironmentEntitlementsState> => {
    try {
      const params: any = { $top: 200 };
      if (orgId) params.$filter = { organization_id: orgId };
      const res = await dataSource.find('sys_environment', params);
      const rows: any[] = Array.isArray(res) ? res : res?.data ?? [];
      const active = rows.filter((r) => !TERMINAL_STATUSES.has(String(r?.status ?? '')));
      const hasProductionEnv = active.some((r) => classifyEnvironmentType(r) === 'production');
      return {
        ready: true,
        hasProductionEnv,
        canCreateDevelopmentEnv: undefined,
        source: 'derived',
      };
    } catch {
      return {
        ready: false,
        hasProductionEnv: false,
        canCreateDevelopmentEnv: undefined,
        source: 'unknown',
      };
    }
  };

  return (await fromSummary()) ?? (await fromRows());
}

/**
 * The shared resource for one (origin, organisation). `value` is the settled
 * answer (`undefined` until the first resolution lands); `generation` lets a
 * superseded or dropped resolution discard its answer instead of writing it.
 */
interface EntitlementsResource {
  value: EnvironmentEntitlementsState | undefined;
  inFlight: boolean;
  generation: number;
  readers: number;
  listeners: Set<() => void>;
}

const resources = new Map<string, EntitlementsResource>();

function resolveInto(resource: EntitlementsResource, opts: EntitlementsResolveOptions): void {
  const generation = ++resource.generation;
  resource.inFlight = true;
  void resolveEntitlements(opts).then((next) => {
    if (resource.generation !== generation) return;
    resource.inFlight = false;
    resource.value = next;
    for (const listener of Array.from(resource.listeners)) listener();
  });
}

/** Join the resource for `key`, starting its resolution only if nobody has. */
function acquire(key: string, opts: EntitlementsResolveOptions): EntitlementsResource {
  let resource = resources.get(key);
  if (!resource) {
    resource = { value: undefined, inFlight: false, generation: 0, readers: 0, listeners: new Set() };
    resources.set(key, resource);
  }
  resource.readers += 1;
  if (resource.value === undefined && !resource.inFlight) resolveInto(resource, opts);
  return resource;
}

/**
 * Leave the resource. The drop waits for the end of the current task, so an
 * unmount and a mount committed together (a route change, React StrictMode's
 * effect replay) hand the answer over instead of asking the server twice; it is
 * not a timer, and nothing outlives the readers.
 */
function release(key: string, resource: EntitlementsResource): void {
  resource.readers -= 1;
  if (resource.readers > 0) return;
  queueMicrotask(() => {
    if (resource.readers > 0 || resources.get(key) !== resource) return;
    resources.delete(key);
    resource.generation += 1;
  });
}

export function useEnvironmentEntitlements(
  opts: UseEnvironmentEntitlementsOptions,
): EnvironmentEntitlementsState | null {
  const { enabled, dataSource, authFetch, apiBase, refreshKey } = opts;
  const { activeOrganization } = useAuth();
  const orgId = activeOrganization?.id;
  const [state, setState] = useState<EnvironmentEntitlementsState | null>(null);

  // The resolution runs with whichever reader starts it, so these are read at
  // that moment rather than keyed on: two readers' fetch functions are
  // interchangeable, and keying an effect on a function identity is what
  // AGENTS.md #10 rules out.
  const resolveDeps = useRef({ dataSource, authFetch });
  useEffect(() => {
    resolveDeps.current = { dataSource, authFetch };
  });
  const lastRefresh = useRef<{ key: string; refreshKey: unknown } | null>(null);

  const key = `${(apiBase || '').replace(/\/+$/, '')}\n${orgId ?? ''}`;

  useEffect(() => {
    if (!enabled) {
      lastRefresh.current = null;
      setState(null);
      return;
    }
    const resolveOpts = (): EntitlementsResolveOptions => ({ ...resolveDeps.current, apiBase, orgId });
    const resource = acquire(key, resolveOpts());

    // The explicit invalidation: this reader's `refreshKey` moved while it kept
    // reading the same organisation, so the shared answer is re-resolved for
    // every reader, not only for this one.
    const previous = lastRefresh.current;
    lastRefresh.current = { key, refreshKey };
    if (previous && previous.key === key && !Object.is(previous.refreshKey, refreshKey)) {
      resolveInto(resource, resolveOpts());
    }

    const sync = () => {
      if (resource.value !== undefined) setState(resource.value);
    };
    resource.listeners.add(sync);
    sync();
    return () => {
      resource.listeners.delete(sync);
      release(key, resource);
    };
  }, [enabled, key, apiBase, orgId, refreshKey]);

  return state;
}
