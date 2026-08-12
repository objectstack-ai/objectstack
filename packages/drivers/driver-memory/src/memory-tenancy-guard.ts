// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In-Memory Driver — multi-tenancy boot guard (#6915, mirroring #3724).
 *
 * This driver implements **no row-level tenant isolation**: it never reads
 * `DriverOptions.tenantId`, so reads carry no tenant predicate and writes are
 * never stamped with a tenant column. The SQL family's `resolveTenantField()` +
 * `applyTenantScope()` layer does not exist here at all — which is why
 * `scripts/check-tenant-chokepoint.mjs` scans `driver-sql` /
 * `driver-sqlite-wasm` / `driver-turso` and not this package: a driver that
 * REFUSES multi-tenant has no read-side chokepoint for that gate to re-derive.
 * `distinct(object, field, query?)` does not even accept a `DriverOptions`, so a
 * caller has nowhere to pass a tenant even deliberately.
 *
 * The platform above the driver assumes tenant isolation is a *platform*
 * guarantee (object metadata's `tenancy` block, `applySystemFields` injecting
 * `organization_id`, the engine threading `tenantId` into every driver call).
 * Booting this driver into a multi-tenant deployment therefore produces
 * **silent** cross-tenant reads, updates and deletes — the exact
 * "declared ≠ enforced" shape Prime Directive #10 forbids.
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
 * weaken this gate. Route A stays behind the #5499 investment freeze; a startup
 * refusal is not an investment in this driver's capabilities, it is the removal
 * of a silent failure mode (maintainer ruling, 2026-08-12).
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
        `  InMemoryDriver never reads \`DriverOptions.tenantId\` — reads carry no tenant\n` +
        `  predicate and writes are not stamped with a tenant column, so queries would\n` +
        `  read, update and delete OTHER tenants' records. Rather than run unisolated,\n` +
        `  the driver fails at startup.\n` +
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
 * Whether an object definition asks for row-level tenant isolation.
 *
 * Only an **explicit** `tenancy.enabled === true` counts. An absent `tenancy`
 * block is not treated as a multi-tenant signal here: platform-wide tenant
 * scoping is driven by the deployment posture (checked separately by
 * {@link assertSingleTenantPosture}), and every object in a single-tenant
 * deployment omits the block.
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
 * array-taking signature is kept anyway: it is the precedent's shape, it is
 * what makes the all-offenders-in-one-message property directly testable, and
 * adding a batch path here would be capability investment in a driver whose
 * capabilities are frozen (#5499).
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
