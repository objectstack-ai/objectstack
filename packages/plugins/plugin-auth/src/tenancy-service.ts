// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `tenancy` service — the single source of truth for "what tenancy posture is
 * this deployment in?" (ADR-0093 D4, widened to the three-posture spectrum by
 * ADR-0105 D1).
 *
 * Before this service, the same fact was re-derived from four independent
 * signals that could disagree: the `OS_MULTI_ORG_ENABLED` env flag, the
 * `org-scoping` service probe, `sys_organization` row counting, and the
 * frontend feature flags. The worst disagreement was silent — requesting
 * multi-org without the enterprise `@objectstack/organizations` package degrades
 * to zero tenant isolation with only a console warning (an ADR-0049-class
 * unenforced security property). This service makes the two facts that matter —
 * what was *requested* and what is *actually active* — first-class and
 * queryable, so consumers stop re-deriving and the degraded state stops being
 * silent.
 *
 * ## The three postures (ADR-0105 D1)
 *
 * - `single` — no wall. One logical tenant; sub-units are business units in one
 *   business-unit tree.
 * - `group` — wall = `organization_id IN accessible_org_ids`. Organizations are
 *   membership/invitation boundaries over one shared dataset, with union (MOAC)
 *   read access.
 * - `isolated` — wall = `organization_id = activeOrganizationId`. The hard
 *   legal-entity wall, formerly spelled `multi`.
 *
 * ## Open code, entitled activation
 *
 * Both walled postures require the enterprise `@objectstack/organizations`
 * package (the `org-scoping` service) to ACTIVATE, and both can resolve
 * DEGRADED without it. The wall's implementation is open — the Layer 0
 * compiler, `accessible_org_ids` resolution and the D5 write
 * stamping/validation all ship in open packages — but multi-organization
 * operation is a commercial capability (ADR-0105 D12).
 *
 * That is not in tension with cloud ADR-0016's 铁律 (强制免费、治理收费): the rule
 * guarantees a deployment RUNNING a multi-org shape is safe, which is satisfied
 * by refusing to run one unwalled (ADR-0093 D5), not by giving the posture away.
 *
 * Registered by plugin-auth (the open-core home, alongside the default-org
 * bootstrap).
 */

import {
  postureEnforcesWall,
  type TenancyPosture,
} from '@objectstack/spec/security';

export type { TenancyPosture };

export interface TenancyService {
  /**
   * The posture actually IN FORCE. Equals {@link requestedPosture} whenever the
   * request can be enforced; a walled request that cannot be — `group` or
   * `isolated` alike (ADR-0105 D12) — resolves to `single`, because the
   * deployment behaves single-org-like when nothing isolates its data, and sets
   * {@link degraded}.
   */
  readonly posture: TenancyPosture;
  /** What the operator asked for (`OS_TENANCY_POSTURE` / `OS_MULTI_ORG_ENABLED`). */
  readonly requestedPosture: TenancyPosture;
  /** True iff an organization wall is actually enforced (posture !== `single`). */
  readonly isolationActive: boolean;
  /** True iff a wall-enforcing posture was requested. */
  readonly requested: boolean;
  /**
   * `requested && !isolationActive` — a wall was asked for but cannot be
   * enforced. Boot is refused unless `OS_ALLOW_DEGRADED_TENANCY=1` (serve.ts,
   * ADR-0093 D5); when it boots anyway, this flag brands the deployment
   * everywhere an operator looks (`/auth/config`, Setup dashboard).
   *
   * Reachable for BOTH walled postures. `group` probes the enterprise
   * `org-scoping` runtime exactly like `isolated` does (ADR-0105 D12) — the
   * wall's CODE is open, but ACTIVATING a multi-organization posture is an
   * entitlement. So either posture degrades when that runtime is absent, and
   * also when it is installed but declares (`supportedPostures`) that it does
   * not entitle the posture requested.
   */
  readonly degraded: boolean;
  /**
   * The default organization id to bind new users to when no wall is enforced
   * (ADR-0093 D3). Returns `null` whenever a walled posture was REQUESTED — the
   * framework never guesses a target org there; invite / add-member / SSO JIT
   * own membership. Also `null` before an org exists (e.g. before the
   * default-org bootstrap runs). Positive resolutions are memoized (the id is
   * stable).
   *
   * Keyed on {@link requestedPosture}, not on {@link posture}: a DEGRADED
   * deployment asked for a wall and did not get one, and the safe reading of
   * that is "I don't know which org this user belongs to", not "everyone
   * belongs to the only org I can see". Guessing there is the failure ADR-0093
   * D6 already refuses for the backfill — "a wrong org in a tenant-isolated
   * deployment is a data-exposure bug, not a convenience" — and it reached
   * production once (cloud#957): a control plane running `isolated` without the
   * enterprise package bound every fresh self-serve signup into whichever
   * organization happened to be the only one, handing them its environments.
   * Degrading the WALL is survivable; degrading into cross-tenant writes is not.
   */
  defaultOrgId(): Promise<string | null>;
}

export interface TenancyServiceDeps {
  /**
   * The requested posture (`resolveTenancyPosture()`). Accepts the legacy
   * boolean shape too: `true` ⇒ `isolated`, `false` ⇒ `single`.
   */
  requested: TenancyPosture | boolean;
  /**
   * Whether the enterprise org-scoping machinery is wired. Called lazily (never
   * at construction — the org-scoping provider registers after plugin-auth) and
   * cheap (a service-registry lookup); consumers that read it hot should cache
   * the result themselves, as SecurityPlugin does at `start()`.
   *
   * Consulted for BOTH walled postures (`group` and `isolated`).
   */
  probeIsolation: () => boolean;
  /**
   * [ADR-0105 D12] Which walled postures the installed multi-org runtime
   * ENTITLES, as declared by that runtime itself (`org-scoping`'s optional
   * `supportedPostures`).
   *
   * Presence-of-package is a coarse entitlement: it answers "may this
   * deployment run multi-org at all", not "which shapes of it". Deciding that
   * `group` and `isolated` are the same commercial tier — or different ones —
   * is a PACKAGING policy, and packaging policy belongs to the commercial
   * runtime, not to this open-core service. So the open side asks instead of
   * assuming, and fails closed on anything not entitled.
   *
   * `undefined` (no declaration) means "every walled posture", preserving the
   * behavior of every runtime that predates this seam.
   */
  probeEntitledPostures?: () => readonly TenancyPosture[] | undefined;
  /** ObjectQL engine accessor, for {@link TenancyService.defaultOrgId}. */
  getEngine?: () => unknown | undefined;
  logger?: { info?: (msg: string, meta?: any) => void; warn?: (msg: string, meta?: any) => void };
}

const SYSTEM_CTX = { isSystem: true };

async function findRows(
  engine: any,
  object: string,
  where: Record<string, unknown>,
  limit: number,
): Promise<any[]> {
  if (!engine || typeof engine.find !== 'function') return [];
  try {
    const rows = await engine.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : Array.isArray(rows?.records) ? rows.records : [];
  } catch {
    return [];
  }
}

/**
 * Resolve the single-org default organization: prefer the stable `slug='default'`
 * bootstrap org, else the sole org row when exactly one exists. Returns `null`
 * when there is no unambiguous single org (none yet, or ≥2 — the latter is a
 * multi-org shape and this should not have been called).
 */
export async function resolveDefaultOrgId(engine: any): Promise<string | null> {
  const bySlug = await findRows(engine, 'sys_organization', { slug: 'default' }, 1);
  if (bySlug[0]?.id) return String(bySlug[0].id);
  const any = await findRows(engine, 'sys_organization', {}, 2);
  if (any.length === 1 && any[0]?.id) return String(any[0].id);
  return null;
}

function normalizeRequested(requested: TenancyPosture | boolean): TenancyPosture {
  if (typeof requested === 'boolean') return requested ? 'isolated' : 'single';
  return requested;
}

export function createTenancyService(deps: TenancyServiceDeps): TenancyService {
  let cachedDefaultOrgId: string | null = null;
  const requestedPosture = normalizeRequested(deps.requested);

  /**
   * Can the REQUESTED posture actually be enforced?
   *
   * - `single` — nothing to enforce.
   * - `group` / `isolated` — only with the org-scoping machinery registered.
   *
   * BOTH walled postures probe. The wall's CODE is open (the Layer 0 compiler,
   * `accessible_org_ids` resolution and D5 stamping all live in open packages),
   * but ENABLING a multi-organization posture is an entitlement — exactly the
   * shape `isolated` has always had (ADR-0105 D12). Open code, entitled activation:
   * the two are separate questions, and conflating them is what briefly made
   * `group` a free multi-org back door around the `isolated` gate.
   *
   * This does not weaken cloud ADR-0016's iron rule (强制免费、治理收费). The rule
   * is that a deployment RUNNING the group shape must be safe, not that anyone
   * may switch it on: a `group` request that cannot be enforced resolves to
   * `single` and reports {@link TenancyService.degraded}, and the CLI refuses to
   * boot on that unless the operator explicitly opts in (ADR-0093 D5). You never
   * silently get unwalled multi-org — you get a refusal.
   */
  const isolationActive = (): boolean => {
    if (requestedPosture === 'single') return false;
    try {
      if (!deps.probeIsolation()) return false;
      // The runtime is installed; ask whether it entitles THIS posture.
      const entitled = deps.probeEntitledPostures?.();
      if (entitled && !entitled.includes(requestedPosture)) return false;
      return true;
    } catch {
      return false;
    }
  };

  return {
    get requestedPosture(): TenancyPosture {
      return requestedPosture;
    },
    get requested(): boolean {
      return postureEnforcesWall(requestedPosture);
    },
    get isolationActive(): boolean {
      return isolationActive();
    },
    get posture(): TenancyPosture {
      // A wall that cannot be enforced is not a wall: report the posture the
      // deployment actually BEHAVES as, and let `degraded` carry the discrepancy.
      return isolationActive() ? requestedPosture : 'single';
    },
    get degraded(): boolean {
      return postureEnforcesWall(requestedPosture) && !isolationActive();
    },
    async defaultOrgId(): Promise<string | null> {
      // Any walled posture REQUEST — enforced or degraded — means the framework
      // never guesses a target org. See the interface doc for why the degraded
      // case fails closed rather than falling back to "the only org I can see".
      if (postureEnforcesWall(requestedPosture)) return null;
      if (cachedDefaultOrgId) return cachedDefaultOrgId;
      const resolved = await resolveDefaultOrgId(deps.getEngine?.());
      // Memoize only a positive resolution — a null (org not bootstrapped yet)
      // must re-resolve on the next call.
      if (resolved) cachedDefaultOrgId = resolved;
      return resolved;
    },
  };
}
