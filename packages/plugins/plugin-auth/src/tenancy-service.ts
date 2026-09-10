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
 * multi-org without the `@objectstack/organizations` package degrades
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
 * ## What ACTIVATES a wall — and which package that is
 *
 * Both walled postures require the `@objectstack/organizations` package (the
 * `org-scoping` registrar) to ACTIVATE, and both can resolve DEGRADED without
 * it. That mechanism is unchanged. What ADR-0132 changed is the ANSWER to "can
 * an open install have it?", and this file is where a reader comes to ask.
 *
 * ⚠️ ONE NAME, TWO PACKAGES (ADR-0132 D3). This framework publishes an
 * Apache-2.0 package of that name (`packages/plugins/organizations`); a
 * commercial deployment resolves the same name to a private, licence-gated
 * SUBCLASS of it through its own `workspace:*` declaration. Which one is
 * mounted is decided by the manifest that DECLARES the name — never by this
 * service, which cannot tell them apart and must not try.
 *
 * So multi-organization operation is **not** a commercial capability. An open
 * install that has the open package has both walled postures by construction:
 * that runtime declares `['group', 'isolated']` as its own constant rather than
 * as a tier (ADR-0132 D4) and carries no licence check of any kind (D2).
 * ADR-0105 D12's code-vs-activation split still stands, but the entitlement it
 * speaks of now lives entirely in the commercial subclass's own constructor
 * gate — cloud code, cloud gate. Nothing on this side of the line asks.
 *
 * None of that is in tension with cloud ADR-0016's 铁律 (强制免费、治理收费): the
 * rule guarantees a deployment RUNNING a multi-org shape is safe, which is
 * satisfied by refusing to run one unwalled (ADR-0093 D5). It never required
 * withholding the wall, and since ADR-0132 the open tree does not.
 *
 * ## [#17010] The organization census — why `single` stops being silent
 *
 * ADR-0131 §1.2(3) states that the precondition it reasons about — many
 * organizations with Layer 0 inert — 「is today a refused boot」. It is not. A
 * deployment that never REQUESTS a wall and simply HOLDS more than one
 * `sys_organization` row under `single` boots, serves, and says nothing: this
 * file's {@link resolveDefaultOrgId} answers the bootstrap org, else the sole
 * org when exactly one exists, else `null` — silently — and that silence was
 * the whole defect. The harm then surfaces far away and looks unrelated: a
 * platform admin reading zero rows on `/data` (#16645), system-context writes
 * refused `ambiguous-organization` by the per-write guard (#8844), and a
 * decision card re-asking a question ADR-0131 D8 had answered (#16934).
 *
 * ⛔ **Boot PROCEEDS. This census only REPORTS** — ruled for this card by the
 * dispatching seat, 2026-09-10: making the state visible restores a declared
 * invariant and takes nothing away from anyone, whereas actually refusing the
 * boot would stop deployments that run today (the measured instance,
 * `objectstack-ai/ats`, is one). That fork stays open and is the maintainer's.
 * ⛔ Nothing here changes #8844's per-write refusal, which is the write-side
 * guard and this card's evidence rather than its target.
 *
 * **Why the reading lives on {@link TenancyService.defaultOrgId} and not in a
 * new boot hook.** This is the seam that was silent, it is the seam that
 * already reads `sys_organization`, and it already knows the REQUESTED posture
 * — so the census needs no second reader and no second store read to keep in
 * step with. It is reached AT BOOT on a default deployment: `AuthPlugin`
 * registers a `kernel:ready` hook that runs `backfillMemberships` with
 * `resolveTargetOrg: () => tenancy.defaultOrgId()`, and the membership policy
 * that gates it defaults to `auto` (`AuthManager.getMembershipPolicy()`), so
 * `kernel:ready` takes the census. A deployment that opts out of that pass
 * (`OS_SKIP_MEMBERSHIP_BACKFILL=1`, or an `invite-only` policy) takes it at the
 * first single-posture organization resolution instead — still once per
 * process, still before anybody has been mis-bound.
 *
 * Cost: ONE `count(sys_organization)` per process, downstream of the walled
 * early return (a walled posture pays nothing) and downstream of the memoized
 * resolution (a healthy deployment reaches it exactly once). An engine with no
 * `count` — every reduced mock embedding — pays nothing and stays silent.
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
   * Reachable for BOTH walled postures. `group` probes the `org-scoping`
   * runtime exactly like `isolated` does (ADR-0105 D12); since ADR-0132 the
   * wall's code AND the registrar that activates it are both open, so an open
   * install reaches a non-degraded walled posture on its own. Either posture
   * still degrades when that runtime is ABSENT, and also when it is installed
   * but declares (`supportedPostures`) that it does not entitle the posture
   * requested — which the open package never does (it declares both) and a
   * commercial subclass of it may.
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
   * [#17010] The first ANSWERED call under a non-walled posture also takes the
   * organization census and reports at `error` when this deployment holds more
   * than one — see the module doc. The resolution itself is unchanged.
   *
   * Keyed on {@link requestedPosture}, not on {@link posture}: a DEGRADED
   * deployment asked for a wall and did not get one, and the safe reading of
   * that is "I don't know which org this user belongs to", not "everyone
   * belongs to the only org I can see". Guessing there is the failure ADR-0093
   * D6 already refuses for the backfill — "a wrong org in a tenant-isolated
   * deployment is a data-exposure bug, not a convenience" — and it reached
   * production once (cloud#957): a control plane running `isolated` without any
   * `org-scoping` runtime bound every fresh self-serve signup into whichever
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
   * Whether the org-scoping machinery is wired. Called lazily (never
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
   * Presence-of-package answers "is a multi-org runtime mounted at all", not
   * "which shapes of it". The OPEN package leaves nothing to decide: it
   * entitles both walled postures by construction (ADR-0132 D4), and ⛔ that is
   * not a place a tier may later be drawn. This seam exists for the OTHER
   * package sharing the name — a commercial subclass may narrow what IT
   * entitles, and that narrowing is a packaging policy belonging to it rather
   * than to this service. So this side asks instead of assuming, and fails
   * closed on anything not entitled.
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
    return await engine.find(object, { where, limit }, { context: SYSTEM_CTX });
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

/**
 * The stable NAME of this report — the grep token an operator or a support
 * thread keys on, the same way `no_sign_in_account_at_boot` leads its line in
 * `boot-sign-in-reachability.ts`.
 */
export const SINGLE_POSTURE_MANY_ORGANIZATIONS = 'single_posture_holds_many_organizations';

/**
 * The `error` channel this census needs, with the `warn` fallback the
 * #13398-class ruling requires of a sink that may not declare `error`.
 *
 * Declared HERE, at birth, with `error?` beside a REQUIRED `warn` — the #9754
 * shape `check:optional-error-sink-contract` is satisfied by. Field shapes are
 * the ones `ReconcileMembershipDeps['logger']` already carries next door, so a
 * host sink that satisfies one satisfies the other.
 *
 * ⛔ {@link TenancyServiceDeps.logger} is NOT widened to carry this. Growing
 * `error?` onto a published sink that lacks it is exactly what the #13398-class
 * ruling forbids, and that sink's `warn` is OPTIONAL — widening it in place
 * would mint the "an optional `error` with no declared alternative" shape the
 * gate above exists to refuse. {@link asTenancyBootDiagnosticSink} narrows the
 * declared sink to this one at RUNTIME instead, proving the required member
 * rather than asserting it.
 */
export interface TenancyBootDiagnosticLogger {
  info?: (msg: string, meta?: any) => void;
  /** The GUARANTEED channel — what makes the `error` fallback real, not aspirational. */
  warn: (msg: string, meta?: any) => void;
  /** Optional, deliberately (#9754): hosts do inject reduced sinks. */
  error?: (msg: string, meta?: any) => void;
}

/**
 * Narrow the service's declared sink to the census channel, or `undefined`.
 *
 * The declared sink types `warn` as OPTIONAL, so it is not assignable; this
 * checks for the member instead of asserting it, which makes the cast sound and
 * keeps the published type untouched. A host that injected a sink with no
 * `warn` at all gets no report — the direction that fails quiet rather than
 * throwing inside a diagnostic — and every host in this repository passes the
 * kernel logger, which carries both `warn` and `error`.
 */
export function asTenancyBootDiagnosticSink(
  logger: TenancyServiceDeps['logger'],
): TenancyBootDiagnosticLogger | undefined {
  return typeof logger?.warn === 'function' ? (logger as TenancyBootDiagnosticLogger) : undefined;
}

/**
 * What the store said about the organization population, and under which
 * REQUESTED posture it was asked.
 *
 * `organizationCount: null` is NOT a third kind of count — it means the
 * question was not answered (no engine, no `count` capability, a failed read),
 * and every consumer here treats it as "make no claim".
 */
export interface SinglePostureOrganizationCensus {
  /** The REQUESTED posture — what the deployment DECLARED, which is what the report names. */
  posture: TenancyPosture;
  /** `count(sys_organization)`, or `null` when the question was not answered. */
  organizationCount: number | null;
}

/**
 * `count(sys_organization)` as one bounded question. Never throws — a
 * diagnostic that can break a boot is worse than the gap it reports.
 *
 * Uses the engine's `count` (`IDataEngine.count`, one `SELECT COUNT(*)`) rather
 * than paging rows: the report has to NAME the count, and a bounded `find` page
 * cannot say whether it saw the whole population. An engine without `count` —
 * every reduced mock embedding — answers `null` and the census stays silent,
 * because this report makes a POSITIVE claim or none at all.
 */
export async function probeOrganizationCount(engine: any): Promise<number | null> {
  if (!engine || typeof engine.count !== 'function') return null;
  try {
    const counted = await engine.count('sys_organization', {}, { context: SYSTEM_CTX });
    if (typeof counted !== 'number' || !Number.isFinite(counted) || counted < 0) return null;
    return Math.trunc(counted);
  } catch {
    return null;
  }
}

/**
 * The predicate and its message, with no I/O — the whole decision, fact by fact.
 *
 * Returns the report text for the ONE undeclared shape (posture DECLARED
 * `single`, more than one organization actually held), or `null` for every
 * other shape. Each `null` is `null` for its own reason:
 *
 *   - **a walled posture was requested** — the organizations are declared, the
 *     wall is the deployment's own answer, and #8844's per-write refusal owns
 *     the degraded case;
 *   - **one organization, or none yet** — the healthy `single` deployment, and
 *     the pre-bootstrap one on its way there. ⛔ A check that fires on a healthy
 *     install is worse than no check;
 *   - **`null` count** — the store was not consulted. An absence of measurement
 *     is not evidence of a defect.
 */
export function resolveSinglePostureManyOrganizationsReport(
  census: SinglePostureOrganizationCensus,
): string | null {
  if (postureEnforcesWall(census.posture)) return null;
  const count = census.organizationCount;
  if (count === null || count <= 1) return null;

  return (
    `[auth] ${SINGLE_POSTURE_MANY_ORGANIZATIONS}: this deployment DECLARES the '${census.posture}' `
    + `tenancy posture and HOLDS ${count} 'sys_organization' rows. Under '${census.posture}' there is `
    + 'no organization wall and the Default Organization is taken to be the only one (ADR-0131 D9), so '
    + 'nothing refused this boot and THE DEPLOYMENT WILL KEEP LOOKING HEALTHY — the loss surfaces far '
    + 'from here, and looks like an unrelated data outage: the framework refuses to guess a default '
    + 'organization once more than one exists, so users reconciled from now on are bound to NO '
    + 'organization at all; a platform admin whose session carries one organization then reads ZERO '
    + 'rows of every organization-stamped object while analytics and the driver still count them; and '
    + "system-context writes to any tenant-column object are refused 'ambiguous-organization'. TWO WAYS "
    + 'OUT, and this deployment has to pick one: (1) DECLARE A WALLED POSTURE — set '
    + "OS_TENANCY_POSTURE=group (one shared dataset, organizations as membership boundaries) or "
    + "OS_TENANCY_POSTURE=isolated (the hard legal-entity wall) and install the "
    + "'@objectstack/organizations' package that ACTIVATES it, which turns the organizations this "
    + 'store already holds into real boundaries instead of undeclared ones; or (2) HOLD ONE '
    + "ORGANIZATION — merge the rows down to a single 'sys_organization' and model the sub-units as "
    + "business units in one business-unit tree, which is what '"
    + `${census.posture}' means. Nothing here happens by itself.`
  );
}

/**
 * Emit the census report when this deployment is in the undeclared shape.
 * Returns the message that was logged, or `null` when nothing was wrong — the
 * return value is what tests assert on, so a shape that must stay quiet is
 * pinned by `null` rather than by the absence of a log call.
 *
 * `error`, not `warn`, and AGENTS.md → "Degradation log levels" decides it with
 * one question: after the degradation, does the system still look normal from
 * the outside while something it claims is true has not landed? Emphatically
 * yes — the runtime boots clean and serves, and the invariant ADR-0131 D9
 * states ("the Default Organization is the only one") is simply false. ⛔ `warn`
 * is what exists today, in effect: this state is currently SILENT, so reporting
 * it below `error` is the failure mode, not the fix.
 *
 * Never throws.
 */
export function reportIfSinglePostureHoldsManyOrganizations(
  census: SinglePostureOrganizationCensus,
  logger?: TenancyBootDiagnosticLogger,
): string | null {
  let message: string | null = null;
  try {
    message = resolveSinglePostureManyOrganizationsReport(census);
  } catch {
    return null;
  }
  if (!message) return null;
  const meta = { posture: census.posture, organizationCount: census.organizationCount };
  try {
    // ⛔ NOT `logger?.error?.(…)` — that prints NOTHING against a sink with no
    // `error`, silently dropping the loudest line here in order to look tidy.
    // The property-access call form also keeps the receiver, which a class-based
    // `ObjectLogger` needs (`ensure-default-organization.ts` carries the measurement).
    if (logger?.error) logger.error(message, meta);
    else logger?.warn(message, meta);
  } catch {
    /* a logger that throws must not abort the boot */
  }
  return message;
}

function normalizeRequested(requested: TenancyPosture | boolean): TenancyPosture {
  if (typeof requested === 'boolean') return requested ? 'isolated' : 'single';
  return requested;
}

export function createTenancyService(deps: TenancyServiceDeps): TenancyService {
  let cachedDefaultOrgId: string | null = null;
  // [#17010] Whether the organization census below has been ANSWERED yet.
  // Latched on the first answered reading — never on an unanswered one, or a
  // boot that reached this seam before the engine was resolvable would disable
  // the census for the life of the process.
  let organizationCensusTaken = false;
  const requestedPosture = normalizeRequested(deps.requested);

  /**
   * Can the REQUESTED posture actually be enforced?
   *
   * - `single` — nothing to enforce.
   * - `group` / `isolated` — only with the org-scoping machinery registered.
   *
   * BOTH walled postures probe, and they probe the SAME registrar — exactly the
   * shape `isolated` has always had (ADR-0105 D12). That symmetry is the point:
   * treating the two as different questions is what briefly made `group` a free
   * multi-org back door around the `isolated` gate (#3570).
   *
   * Since ADR-0132 the registrar is open as well as the wall, so an open
   * install passes this probe on its own — `packages/plugins/organizations` is
   * Apache-2.0 and carries no licence check. What is left on the commercial
   * side is the private subclass's own constructor gate, which fails the MOUNT
   * before this code ever runs, and `supportedPostures`, read just below.
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
      // The census below is downstream of this line on purpose: a walled
      // deployment DECLARED its organizations and pays nothing here.
      if (postureEnforcesWall(requestedPosture)) return null;
      if (cachedDefaultOrgId) return cachedDefaultOrgId;
      const engine = deps.getEngine?.();
      const resolved = await resolveDefaultOrgId(engine);
      // Memoize only a positive resolution — a null (org not bootstrapped yet)
      // must re-resolve on the next call.
      if (resolved) cachedDefaultOrgId = resolved;
      // [#17010] The organization census — one `count(sys_organization)`, once
      // per process, on the seam that was already reading this object.
      if (!organizationCensusTaken) {
        const organizationCount = await probeOrganizationCount(engine);
        if (organizationCount !== null) {
          organizationCensusTaken = true;
          reportIfSinglePostureHoldsManyOrganizations(
            { posture: requestedPosture, organizationCount },
            asTenancyBootDiagnosticSink(deps.logger),
          );
        }
      }
      return resolved;
    },
  };
}
