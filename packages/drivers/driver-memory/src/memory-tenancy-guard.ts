// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In-Memory Driver — multi-tenancy boot guard (#6915, mirroring #3724).
 *
 * This driver implements **half** of row-level tenant isolation, and the guard
 * below exists because of the missing half. Since #16589 it DOES read
 * `DriverOptions.tenantId` / `tenantIds`: `memory-tenant-scope.ts` is the read
 * side, and every door that takes a `DriverOptions` routes through it. What is
 * still absent is the WRITE side — nothing stamps a tenant column on insert the
 * way `SqlDriver.injectTenantOnInsert` does, so a row created without an
 * explicit organization lands org-less and is then global to every caller.
 * Running walled on that is worse than refusing, which is what this guard does.
 *
 * The SQL family's `getBuilder()` + `applyTenantScope()` layer still does not
 * exist here — this driver filters an array rather than building a query — so
 * `scripts/check-tenant-chokepoint.mjs` continues to scan `driver-sql` /
 * `driver-sqlite-wasm` / `driver-turso` and not this package: its criterion is
 * the knex builder, which has nothing to key on here. The in-memory doors are
 * held by `memory-tenant-scope.test.ts` instead.
 * `distinct(object, field, query?)` does not even accept a `DriverOptions`, so a
 * caller has nowhere to pass a tenant even deliberately — it is the one read
 * door the scope above cannot reach, named here rather than left to be found.
 *
 * The platform above the driver assumes tenant isolation is a *platform*
 * guarantee (object metadata's `tenancy` block, `applySystemFields` injecting
 * `organization_id`, the engine threading `tenantId` into every driver call).
 * Booting this driver into a multi-tenant deployment therefore produces
 * **silently unstamped writes** — rows that belong to no organization and are
 * consequently readable by all of them — the exact "declared ≠ enforced" shape
 * Prime Directive #10 forbids. Until #16589 the reads were silently
 * cross-tenant as well.
 *
 * So the driver refuses to run there. It is positioned as a **dev / demo /
 * in-process** driver (#5704 moved the project's own test backends to sqlite
 * `:memory:`) and fails fast — loudly, at startup — the moment it detects
 * multi-tenant mode:
 *
 *   1. The deployment's tenancy posture is not `single` (deployment-level signal)
 *      → {@link assertSingleTenantPosture}, called from the `InMemoryDriver`
 *      **constructor** and re-checked in `connect()`.
 *   2. An object declares `tenancy.enabled: true` (metadata-level signal) →
 *      {@link assertObjectsNotTenantScoped}, called from `syncSchema`.
 *
 * ## Why both seams, and not just one
 *
 * `connect()` alone is not enough: `ObjectQLEngine.init()` downgrades a driver's
 * connect rejection to a warning when the operator sets
 * `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`, which would boot the deployment
 * unisolated again — the precise failure this guard removes. Construction is
 * behind no such hatch. `connect()` is kept because it is the seam that aborts
 * kernel bootstrap with this message (framework#3741) and because it catches a
 * host that flips the posture between construction and connect.
 *
 * There is deliberately **no escape-hatch env var of its own**: an override
 * would restore exactly the silent non-isolation this guard exists to remove.
 * Multi-tenant deployments use `@objectstack/driver-sql`, which implements
 * driver-level tenant scoping. When real demand for in-memory multi-tenancy
 * appears, the fix is to implement the isolation (option A in #6915) — not to
 * weaken this gate. Route A sat behind the #5499 investment freeze; that freeze
 * dissolved 2026-08-11 (head note of `@objectstack/spec`'s
 * `aggregation-conformance.ts`), so Route A is now unbuilt and owned by #6915
 * rather than blocked by a freeze. The ruling this guard rests on is untouched
 * by the dissolution — it POSTDATES it: a startup refusal is not an investment
 * in this driver's capabilities, it is the removal of a silent failure mode
 * (maintainer ruling, 2026-08-12).
 */

import { resolveTenancyPosture } from '@objectstack/types';

/** Stable, matchable error code for the boot refusal. */
export const MULTI_TENANT_UNSUPPORTED_CODE = 'MEMORY_MULTI_TENANT_UNSUPPORTED';

const ISSUE_URL = 'https://github.com/objectstack-ai/objectstack/issues/6915';

/**
 * Thrown when the in-memory driver is asked to run in a multi-tenant deployment.
 *
 * Carries {@link MULTI_TENANT_UNSUPPORTED_CODE} as `code` so hosts (CLI boot,
 * runtime plugin loader, tests) can recognise it without string-matching the
 * message or relying on cross-realm `instanceof`.
 */
export class MemoryMultiTenantUnsupportedError extends Error {
  public readonly code = MULTI_TENANT_UNSUPPORTED_CODE;

  constructor(detected: string, remedy: string) {
    super(
      `[driver-memory] Refusing to start: this driver has NO row-level tenant isolation.\n` +
        `\n` +
        `  Detected: ${detected}\n` +
        `\n` +
        `  InMemoryDriver scopes reads, updates and deletes by \`DriverOptions.tenantId\`\n` +
        `  (#16589), but it does NOT stamp a tenant column on writes: a record created\n` +
        `  without an explicit organization lands with none, and a record with no\n` +
        `  organization is visible to EVERY tenant. Rather than run half-isolated, the\n` +
        `  driver fails at startup.\n` +
        `\n` +
        `  Fix one of:\n` +
        `    • Use @objectstack/driver-sql (PostgreSQL / MySQL / SQLite) for multi-tenant\n` +
        `      deployments — it enforces tenant scoping at the driver level. For an\n` +
        `      in-process store, \`SqlDriver\` with \`connection: { filename: ':memory:' }\`\n` +
        `      is the closest drop-in replacement.\n` +
        `    ${remedy}\n` +
        `\n` +
        `  Tracking: ${ISSUE_URL}`,
    );
    this.name = 'MemoryMultiTenantUnsupportedError';
  }
}

/** Minimal shape of an object definition this guard inspects. */
export interface TenancyAwareSchema {
  tenancy?: { enabled?: boolean } | null;
}

/**
 * Whether an object definition asks for row-level tenant isolation **loudly
 * enough that this driver must refuse to allocate its table at all**.
 *
 * Only an **explicit** `tenancy.enabled === true` counts, because that is the
 * declaration asking for the half this driver does not have: a tenant column
 * stamped on every insert. Platform-wide posture is checked separately by
 * {@link assertSingleTenantPosture}.
 *
 * ⚠️ This is deliberately NOT the engine's predicate, and that difference is
 * where #16589 lived. `Engine.buildDriverOptions` scopes unless the object opts
 * OUT (`tenantId !== undefined && !isTenancyDisabled(schema) && !isFederated`),
 * so an object that OMITS the `tenancy` block — the common case — is scoped by
 * the engine while this function answers `false` about it. That gap used to be
 * silence: the driver discarded the `tenantId` and handed back every
 * organization's rows. It is no longer silence — `memory-tenant-scope.ts`
 * honours the scope on the read path — so what is left here is only the
 * refusal, which is narrower than the scope on purpose.
 *
 * ⛔ The sentence this docstring used to carry — *"every object in a
 * single-tenant deployment omits the block"* — was FALSE, and it was
 * load-bearing, so it is recorded here rather than quietly deleted. `single`
 * constrains the **wall**, not the number of organizations: a `single`-posture
 * run was measured holding **13** `sys_organization` rows (twelve seeded by the
 * app, one the platform mints for the admin), and rows carry whichever
 * `organization_id` they were written with. The engine's scope is therefore
 * meaningful under `single`, and discarding it changed results.
 */
export function declaresTenantScope(schema: unknown): boolean {
  return (schema as TenancyAwareSchema | null | undefined)?.tenancy?.enabled === true;
}

/**
 * Refuse to run unless the deployment's tenancy posture is `single`.
 *
 * Reads the posture through the shared `resolveTenancyPosture()` resolver
 * (ADR-0105 D1) — the canonical knob, which also subsumes the legacy
 * `OS_MULTI_ORG_ENABLED` boolean — so the driver, auth, the registry and the
 * CLI can never disagree about the mode. Both walled postures (`group` and
 * `isolated`) need an organization wall this driver cannot draw, so both are
 * refused; only `single` passes.
 */
export function assertSingleTenantPosture(): void {
  const posture = resolveTenancyPosture();
  if (posture === 'single') return;
  throw new MemoryMultiTenantUnsupportedError(
    `tenancy posture \`${posture}\` — a multi-tenant deployment ` +
      '(from `OS_TENANCY_POSTURE`, or derived from `OS_MULTI_ORG_ENABLED`)',
    '• Run this deployment single-tenant: `OS_TENANCY_POSTURE=single` (and unset\n' +
      '      `OS_MULTI_ORG_ENABLED`, or set it to `false`).',
  );
}

/**
 * Refuse to sync object schemas that declare row-level tenant isolation.
 *
 * Reports **every** offending object in one message so an operator fixes the
 * whole set in one pass instead of rediscovering them one boot at a time.
 *
 * This driver has no `syncSchemasBatch()` (it does not advertise
 * `supports.batchSchemaSync`, so the engine syncs one object per call), which
 * means the batch shape is reached one object at a time in practice. The
 * array-taking signature is kept anyway: it is the precedent's shape, and it is
 * what makes the all-offenders-in-one-message property directly testable.
 * Adding a batch path here would be capability investment, which the #5499
 * freeze ruled out while it stood; that freeze dissolved 2026-08-11 (head note
 * of `@objectstack/spec`'s `aggregation-conformance.ts`), so the batch path is
 * now merely unasked-for — this driver still advertises no
 * `supports.batchSchemaSync`.
 */
export function assertObjectsNotTenantScoped(
  schemas: Array<{ object: string; schema: unknown }>,
): void {
  const offenders = schemas
    .filter(({ schema }) => declaresTenantScope(schema))
    .map(({ object }) => object);

  if (offenders.length === 0) return;

  const list = offenders.map((name) => `\`${name}\``).join(', ');
  throw new MemoryMultiTenantUnsupportedError(
    `object${offenders.length > 1 ? 's' : ''} declaring \`tenancy.enabled: true\`: ${list}`,
    '• Drop the `tenancy` block from ' +
      (offenders.length > 1 ? 'these objects' : 'this object') +
      ' if the data is genuinely single-tenant.',
  );
}
