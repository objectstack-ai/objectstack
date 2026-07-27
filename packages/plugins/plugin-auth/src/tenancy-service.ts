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
 *   read access. **Enforced by the OPEN engine**: the Layer 0 union wall, the
 *   `accessible_org_ids` resolution, and the D5 write stamping/validation all
 *   ship open, because the correctness of a wall is never a paid feature
 *   (cloud ADR-0016 铁律「强制免费、治理收费」). Managing organizations at
 *   scale stays commercial.
 * - `isolated` — wall = `organization_id = activeOrganizationId`. The hard
 *   legal-entity wall, formerly spelled `multi`. Its machinery still comes from
 *   the enterprise `@objectstack/organizations` package, so this posture keeps
 *   the historical `org-scoping` probe and can still resolve DEGRADED.
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
   * request can be enforced; an `isolated` request that cannot be (the
   * enterprise package is absent) resolves to `single` — the deployment behaves
   * single-org-like because nothing isolates its data — and sets
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
   * Only reachable for `isolated` — `group` is enforced by the open engine, so
   * it has no missing dependency to degrade against.
   */
  readonly degraded: boolean;
  /**
   * The default organization id to bind new users to when no wall is enforced
   * (ADR-0093 D3). Returns `null` under any walled posture — the framework
   * never guesses a target org there; invite / add-member / SSO JIT own
   * membership. Also `null` before an org exists (e.g. before the default-org
   * bootstrap runs). Positive resolutions are memoized (the id is stable).
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
   * Consulted ONLY for the `isolated` posture. `group` is enforced by the open
   * engine and never probes.
   */
  probeIsolation: () => boolean;
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
   * - `group` — always: the union wall, `accessible_org_ids`, and write
   *   stamping/validation are all open-engine code (ADR-0105 D12).
   * - `isolated` — only with the enterprise org-scoping machinery.
   */
  const isolationActive = (): boolean => {
    if (requestedPosture === 'single') return false;
    if (requestedPosture === 'group') return true;
    try {
      return !!deps.probeIsolation();
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
      // Any walled posture: the framework never guesses a target org.
      if (isolationActive()) return null;
      if (cachedDefaultOrgId) return cachedDefaultOrgId;
      const resolved = await resolveDefaultOrgId(deps.getEngine?.());
      // Memoize only a positive resolution — a null (org not bootstrapped yet)
      // must re-resolve on the next call.
      if (resolved) cachedDefaultOrgId = resolved;
      return resolved;
    },
  };
}
