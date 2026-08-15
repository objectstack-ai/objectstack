// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * System-context write organization resolution (#8844) — the RUNTIME twin of
 * #8686's seed-path fix, one layer up.
 *
 * ## The defect
 *
 * A session write carries the caller's active organization
 * (`ExecutionContext.tenantId`), and the driver stamps it onto the row
 * (`injectTenantOnInsert`) before the autonumber counter reads it
 * (`fillAutoNumberFields`, which resolves `row[tenantField] ?? options.tenantId
 * ?? null`). A SYSTEM-context write — a hook, a scheduled job, a custom
 * endpoint, a `runAs: system` flow — carries no organization at all, so the
 * column lands NULL and the counter files the row under the `__global__`
 * pseudo-tenant. One object then runs TWO counters that cannot see each other,
 * each correct within its own scope, and both hand out the same number:
 *
 *     _objectstack_sequences, one object, one scope key:
 *       tenant_id = 'org_msokm9oaz0cal87q'   last_value = 2   <- REST / Console
 *       tenant_id = '__global__'             last_value = 2   <- system context
 *
 * The partitioned unique index — `(COALESCE(organization_id, '__global__'),
 * <field>)`, ADR-0120 D3 — cannot see across the two partitions either, so a
 * field the app declared `unique` holds the same value twice with no error and
 * no warning. Measured on 17.0.0 GA across five objects on one install.
 *
 * ⛔ This is NOT a counter bug and must never be "fixed" by making the allocator
 * smarter — the reasoning `seed-tenancy-backfill.ts` records applies unchanged:
 * both counters are already correct within their own scope. The defect is
 * upstream of the counter, in who resolves the organization for the write.
 * #8686's backfill cannot reach it either: a backfill repairs rows that exist,
 * while this producer mints a fresh duplicate on every hook and every cron tick
 * — which is what makes the backfill self-undoing on any install with
 * server-side automation, i.e. every business app.
 *
 * ## The ruling (maintainer, 2026-08-15, #8844 — Option 1)
 *
 * A system-context write on a tenant-scoped object resolves the install's
 * organization THE WAY A SESSION WRITE DOES. Three binding points shape this
 * module:
 *
 *  1. **Single-tenant: derivable ⇒ derive and stamp.** The `__global__` fork
 *     must stop being minted by hooks, cron and system endpoints.
 *  2. **Multi-tenant: carry an explicit organization or be REFUSED LOUDLY.**
 *     ⛔ Never silently default to `__global__`. A walled install has no
 *     derivable answer to "which organization owns this row", and guessing one
 *     writes a row into a tenant it may not belong to — strictly worse than
 *     refusing.
 *  3. **Already-minted duplicates are REPORTED, never rewritten** — #8686's
 *     posture. Nothing here renumbers anything; this module only decides what a
 *     write ABOUT to happen resolves to.
 *
 * ## The three exclusions, and why the refusal is not broader
 *
 * A refusal that fires too widely breaks every system write on a walled install
 * — including the hooks and cron that run unattended, where a loud failure
 * surfaces as a stalled automation rather than as a 4xx someone reads. So the
 * decision runs only where the harm is real, and three populations are outside
 * it BY CONSTRUCTION rather than by exemption:
 *
 *  - **Objects with no organization column, `tenancy.enabled: false` objects
 *    (ADR-0066), and federated objects (ADR-0015).** There is no tenant column
 *    to fork a counter by. The declared way for an object to hold deliberately
 *    org-less rows is `tenancy: { enabled: false }` — a metadata declaration,
 *    loud and checkable — never a per-write bypass flag, which is exactly the
 *    lenient-consumer accommodation Prime Directive #12 forbids.
 *  - **The platform namespaces `sys_` / `cloud_` / `ai_`** ({@link
 *    isPlatformNamespaceObject}). Their rows are deliberately global /
 *    cross-organization: this is #8672's reasoning ("an org-less row is
 *    defensible for `sys_permission_set`"), which the #8844 ruling confirms
 *    holds for platform objects and does NOT generalize to application objects.
 *    The same regexp is the seed loader's own rule for which seeds it will
 *    stamp, and #8686's backfill re-spells it for the same reason this module
 *    does: the three write paths have to agree about the platform namespace, or
 *    one of them manufactures a new disagreement while claiming to remove one.
 *  - **Writes that already carry an organization** — on the execution context
 *    or on the row itself. That IS "carrying an explicit organization"; the
 *    ruling asks for nothing more.
 *
 * ## INSERT only, deliberately
 *
 * The ruling's yardstick is "the way a session write does", and a session write
 * stamps the organization on INSERT — `injectTenantOnInsert` is the insert-side
 * mechanism, and no write path stamps `organization_id` onto an update. An
 * update also cannot fork a counter: the number is minted once, at insert. So
 * extending this to update would not be following the session write, it would
 * be inventing a second rule.
 */

import type { TenancyPosture } from '@objectstack/spec/security';
import { SystemObjectName } from '@objectstack/spec/system';

/**
 * The table the "how many organizations does this install have?" probe counts —
 * the one protocol-level name, not a re-spelling (`SystemObjectName`).
 */
export const ORGANIZATION_OBJECT = SystemObjectName.ORGANIZATION;

/**
 * The NULL-organization sentinel the SQL driver's counter and partitioned
 * unique index collapse a missing organization to (`GLOBAL_TENANT` in
 * `driver-sql`, ADR-0120 D3). Named here only to make the refusal message say
 * what it is refusing to write; nothing in this module produces the value.
 */
export const GLOBAL_TENANT = '__global__';

/**
 * The tenant column the kernel injects into every tenant-scoped object
 * (`TENANT_SCOPE_FIELD_DEF`, `registry.ts`), and the fallback every layer
 * assumes when an object declares no `tenancy.tenantField`.
 */
export const DEFAULT_TENANT_FIELD = 'organization_id';

/**
 * Platform namespaces whose rows are deliberately global / cross-organization
 * and must never be adopted into one.
 *
 * The seed loader's rule verbatim (`/^(sys_|cloud_|ai_)/` in `seed-loader.ts`),
 * re-spelled here rather than imported for the reason `seed-tenancy-backfill.ts`
 * records about its own copy: the layers differ, the rule must not. This is the
 * third write path to carry it, and the three have to stay in step — a runtime
 * stamp that adopted a namespace the loader deliberately leaves global would
 * reopen the seed/runtime disagreement from the other end.
 */
const PLATFORM_NAMESPACE = /^(sys_|cloud_|ai_)/;

/** Is this object in a platform namespace whose rows stay org-less by design? */
export function isPlatformNamespaceObject(object: string): boolean {
  return PLATFORM_NAMESPACE.test(object);
}

/**
 * Resolve the column an object is tenant-scoped by, or `null` when it is not
 * tenant-scoped at all.
 *
 * The twin of `SqlDriver.computeTenantField`, same precedence and same reading:
 * an explicit `tenancy.enabled: false` opt-out wins over any column-presence
 * heuristic (ADR-0066 / `isTenancyDisabled`), then a declared
 * `tenancy.tenantField` that the object really has, then the kernel-injected
 * `organization_id`. It is re-spelled rather than imported because the engine
 * must not depend on a driver — but it has to stay the same rule: a disagreement
 * here would mean the engine resolves an organization for a column the driver
 * does not scope by, or refuses a write the driver would have filed globally.
 */
export function resolveTenantFieldName(schema: unknown): string | null {
  const s = schema as
    | { fields?: Record<string, unknown>; tenancy?: { enabled?: boolean; tenantField?: unknown } }
    | null
    | undefined;
  if (s?.tenancy?.enabled === false) return null;
  const fields = s?.fields;
  if (!fields || typeof fields !== 'object') return null;
  const declared = s?.tenancy?.tenantField;
  if (typeof declared === 'string' && declared !== '' &&
      Object.prototype.hasOwnProperty.call(fields, declared)) {
    return declared;
  }
  if (Object.prototype.hasOwnProperty.call(fields, DEFAULT_TENANT_FIELD)) return DEFAULT_TENANT_FIELD;
  return null;
}

/** Does this value count as an organization actually supplied? */
export function carriesOrganization(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * What a system-context write's organization resolves to.
 *
 * `refuse` is a decision, not a throw: the caller turns it into
 * {@link SystemWriteOrganizationRequiredError} so the decision stays a pure,
 * directly-testable function of the facts.
 */
export type SystemWriteOrganizationDecision =
  /**
   * Nothing to resolve — the install has no organization yet, which is the
   * normal state of a fresh boot (seeds land during `start()`; the admin, and
   * with them the first organization, arrive by a later sign-up POST). No
   * organization exists, so nothing can be stamped and — crucially — nothing is
   * forked either: there is no second partition to fork away from. #8686's
   * `sys_organization`-insert handoff adopts exactly these rows the moment the
   * answer becomes derivable. ⛔ Refusing here would refuse first boot itself.
   */
  | { kind: 'no-organization-yet' }
  /** Binding point 1: exactly one organization, so the answer is derivable. */
  | { kind: 'derived'; organizationId: string }
  /** Binding point 2: refuse loudly rather than default to `__global__`. */
  | { kind: 'refuse'; reason: SystemWriteRefusalReason; organizationCount?: number };

export type SystemWriteRefusalReason =
  /**
   * A walled posture (`group` / `isolated`). Organizations are a real boundary
   * here, so "the install's organization" is not a thing that exists.
   */
  | 'walled-posture'
  /**
   * The posture says `single` but the data holds several organizations. The
   * posture is what the deployment ASKED for; the count is what the data
   * actually is, and where they disagree there is no unambiguous answer — the
   * topology falls under binding point 2 rather than getting a guessed default.
   * #8686's backfill draws the same line (`skipped-ambiguous-organization`).
   */
  | 'ambiguous-organization';

/**
 * Resolve the organization a system-context write should carry.
 *
 * `probeOrganizations` is called ONLY on the single-tenant branch — a walled
 * posture is refused without asking the database anything, because the answer
 * could not change the verdict.
 */
export async function resolveSystemWriteOrganization(args: {
  posture: TenancyPosture;
  /** Organization ids, capped at 2 by the caller — only "0 / 1 / several" matters. */
  probeOrganizations: () => Promise<readonly string[]>;
}): Promise<SystemWriteOrganizationDecision> {
  if (args.posture !== 'single') {
    return { kind: 'refuse', reason: 'walled-posture' };
  }
  const ids = await args.probeOrganizations();
  if (ids.length === 0) return { kind: 'no-organization-yet' };
  if (ids.length === 1) return { kind: 'derived', organizationId: ids[0] };
  return { kind: 'refuse', reason: 'ambiguous-organization', organizationCount: ids.length };
}

/**
 * Compose the refusal message.
 *
 * "Loudly" is a property of what the message SAYS, not of how loudly it is
 * logged: it has to name the condition, what was about to be written, why that
 * is worse than failing, and every way the author can fix it — because the
 * reader is usually an automation author looking at a stalled cron job, not an
 * HTTP client reading a response body.
 */
function buildRefusalMessage(
  object: string,
  posture: TenancyPosture,
  reason: SystemWriteRefusalReason,
  organizationCount: number | undefined,
): string {
  const condition =
    reason === 'walled-posture'
      ? `this install runs the '${posture}' tenancy posture, where organizations are an enforced ` +
        `boundary and there is no single "install organization" to derive`
      : `this install declares the 'single' tenancy posture but holds ` +
        `${organizationCount ?? 'several'} organizations, so which one owns the row is not derivable ` +
        `(exactly 1 is required to adopt one without guessing)`;
  return (
    `Insert on '${object}' was REFUSED: a system-context write on a tenant-scoped object must carry an ` +
    `organization, and ${condition}. Writing it anyway would store ` +
    `${DEFAULT_TENANT_FIELD} = NULL, which the autonumber counter and the partitioned unique index ` +
    `(COALESCE(${DEFAULT_TENANT_FIELD}, '${GLOBAL_TENANT}'), <field>) both collapse to the ` +
    `'${GLOBAL_TENANT}' pseudo-tenant — a second counter that cannot see the organization's own, so a ` +
    `field declared unique silently gets the same value twice (#8844). Nothing was written. Fix it by ` +
    `carrying the organization the way a session write does: pass it on the execution context ` +
    `({ context: { isSystem: true, tenantId: '<organization id>' } }), or set ${DEFAULT_TENANT_FIELD} ` +
    `on the record itself. If rows of '${object}' are genuinely platform-global and belong to no ` +
    `organization, declare that on the OBJECT — tenancy: { enabled: false } (ADR-0066) — so it is ` +
    `stated once and checkable, rather than decided per write.`
  );
}

/**
 * Binding point 2's refusal.
 *
 * Identified by `code` rather than `instanceof`, the convention every engine
 * error here follows so the check survives crossing a package boundary where
 * two copies of this module can exist. `status` is 500 deliberately: the write
 * is refused because SERVER-SIDE code (a hook, a scheduled job, a custom
 * endpoint) did not thread an organization — an HTTP client that happened to
 * trigger it did nothing wrong, and answering 4xx would blame the wrong party
 * and mark the fault `isExpectedDataStatus`, which stops it being logged at all.
 * The declared 5xx withholds the prose from the wire (#5437) and keeps the
 * machine-readable `code`; the prose reaches the person who can act on it
 * through the engine's own ERROR log.
 */
export class SystemWriteOrganizationRequiredError extends Error {
  readonly code = 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED' as const;
  readonly status = 500;

  constructor(
    public readonly object: string,
    public readonly posture: TenancyPosture,
    public readonly reason: SystemWriteRefusalReason,
    public readonly organizationCount?: number,
  ) {
    super(buildRefusalMessage(object, posture, reason, organizationCount));
    this.name = 'SystemWriteOrganizationRequiredError';
  }
}
