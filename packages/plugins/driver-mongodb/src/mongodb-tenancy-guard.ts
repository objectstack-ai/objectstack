// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Driver — multi-tenancy boot guard (#3724)
 *
 * This driver implements **no row-level tenant isolation**: it never reads
 * `DriverOptions.tenantId`, so reads carry no tenant predicate and writes are
 * never stamped with a tenant column. The SQL driver's `resolveTenantField()`
 * + `applyTenantScope()` layer simply does not exist here.
 *
 * The platform above the driver assumes tenant isolation is a *platform*
 * guarantee (object metadata's `tenancy` block, `applySystemFields` injecting
 * `organization_id`, the engine threading `tenantId` into every driver call).
 * Booting this driver into a multi-tenant deployment therefore produces
 * **silent** cross-tenant reads, updates and deletes — the exact
 * "declared ≠ enforced" shape Prime Directive #10 forbids.
 *
 * So the driver refuses to run there. It is positioned as a **single-tenant /
 * embedded** driver and fails fast — loudly, at startup — the moment it detects
 * multi-tenant mode:
 *
 *   1. The deployment's tenancy posture is not `single` (deployment-level signal)
 *      → {@link assertSingleTenantPosture}, called from the `MongoDBDriver`
 *      **constructor** and re-checked in `connect()` before a socket is opened.
 *      Both seams now abort boot: `ObjectQLEngine.init()` propagates a driver's
 *      connect rejection since framework#3741 (it used to catch it and boot
 *      anyway, which is why the check was hoisted into the constructor). The
 *      constructor check is kept because it fails earliest — before a host can
 *      hand the driver to anything — and the `connect()` re-check covers a host
 *      that flips the posture between construction and connect.
 *   2. An object declares `tenancy.enabled: true` (metadata-level signal) →
 *      {@link assertObjectsNotTenantScoped}, called from the `syncSchema` /
 *      `syncSchemasBatch` paths.
 *
 * There is deliberately **no escape-hatch env var**: an override would restore
 * exactly the silent non-isolation this guard exists to remove. Multi-tenant
 * deployments use `@objectstack/driver-sql`, which implements driver-level
 * tenant scoping. When real demand for Mongo multi-tenancy appears, the fix is
 * to implement the isolation (option A in #3724) — not to weaken this gate.
 */

import { resolveTenancyPosture } from '@objectstack/types';

/** Stable, matchable error code for the boot refusal. */
export const MULTI_TENANT_UNSUPPORTED_CODE = 'MONGODB_MULTI_TENANT_UNSUPPORTED';

const ISSUE_URL = 'https://github.com/objectstack-ai/objectstack/issues/3724';

/**
 * Thrown when the MongoDB driver is asked to run in a multi-tenant deployment.
 *
 * Carries {@link MULTI_TENANT_UNSUPPORTED_CODE} as `code` so hosts (CLI boot,
 * runtime plugin loader, tests) can recognise it without string-matching the
 * message or relying on cross-realm `instanceof`.
 */
export class MongoDBMultiTenantUnsupportedError extends Error {
  public readonly code = MULTI_TENANT_UNSUPPORTED_CODE;

  constructor(detected: string, remedy: string) {
    super(
      `[driver-mongodb] Refusing to start: this driver has NO row-level tenant isolation.\n` +
        `\n` +
        `  Detected: ${detected}\n` +
        `\n` +
        `  MongoDBDriver never reads \`DriverOptions.tenantId\` — reads carry no tenant\n` +
        `  predicate and writes are not stamped with a tenant column, so queries would\n` +
        `  read, update and delete OTHER tenants' documents. Rather than run unisolated,\n` +
        `  the driver fails at startup.\n` +
        `\n` +
        `  Fix one of:\n` +
        `    • Use @objectstack/driver-sql (PostgreSQL / MySQL / SQLite) for multi-tenant\n` +
        `      deployments — it enforces tenant scoping at the driver level.\n` +
        `    ${remedy}\n` +
        `\n` +
        `  Tracking: ${ISSUE_URL}`,
    );
    this.name = 'MongoDBMultiTenantUnsupportedError';
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
 * scoping is driven by the deployment flag (checked separately by
 * {@link assertMultiOrgDisabled}), and every object in a single-tenant
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
  throw new MongoDBMultiTenantUnsupportedError(
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
 */
export function assertObjectsNotTenantScoped(
  schemas: Array<{ object: string; schema: unknown }>,
): void {
  const offenders = schemas
    .filter(({ schema }) => declaresTenantScope(schema))
    .map(({ object }) => object);

  if (offenders.length === 0) return;

  const list = offenders.map((name) => `\`${name}\``).join(', ');
  throw new MongoDBMultiTenantUnsupportedError(
    `object${offenders.length > 1 ? 's' : ''} declaring \`tenancy.enabled: true\`: ${list}`,
    '• Drop the `tenancy` block from ' +
      (offenders.length > 1 ? 'these objects' : 'this object') +
      ' if the data is genuinely single-tenant.',
  );
}
