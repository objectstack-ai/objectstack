// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In-Memory Driver — multi-tenancy refusal guard (#6915 boot seams + #16589
 * per-call seam, mirroring #3724).
 *
 * This driver implements **no row-level tenant isolation**: it never SCOPES by
 * `DriverOptions.tenantId`, so reads carry no tenant predicate and writes are
 * never stamped with a tenant column. The SQL family's `resolveTenantField()` +
 * `applyTenantScope()` layer does not exist here at all — which is why
 * `scripts/check-tenant-chokepoint.mjs` scans `driver-sql` /
 * `driver-sqlite-wasm` / `driver-turso` and not this package: a driver that
 * REFUSES multi-tenant has no read-side chokepoint for that gate to re-derive.
 * `distinct(object, field, query?)` does not even accept a `DriverOptions`, so a
 * caller has nowhere to pass a tenant even deliberately.
 *
 * Seam 3 below reads `tenantId` / `tenantIds`, and that is not a walking-back of
 * the sentence above: it inspects the scope only to **refuse the call**, and
 * never to narrow, widen or re-target the rows an operation touches. There is
 * still no value of those options under which this driver answers a scoped
 * query, which is exactly why it remains outside the chokepoint gate's scan.
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
 * `:memory:`) and fails fast — loudly — the moment it detects multi-tenant
 * mode:
 *
 *   1. The deployment's tenancy posture is not `single` (deployment-level signal)
 *      → {@link assertSingleTenantPosture}, called from the `InMemoryDriver`
 *      **constructor** and re-checked in `connect()`.
 *   2. An object declares `tenancy.enabled: true` (metadata-level signal) →
 *      {@link assertObjectsNotTenantScoped}, called from `syncSchema`.
 *   3. The engine hands this driver a tenant scope for one call —
 *      `DriverOptions.tenantId` / `tenantIds` (request-level signal, #16589) →
 *      {@link assertCallNotTenantScoped}, called from every driver door that
 *      accepts a `DriverOptions`.
 *
 * ## Why a THIRD seam — the gap seams 1 and 2 cannot see (#16589)
 *
 * Seams 1 and 2 read the two STATIC signals: the deployment posture and the
 * object's own metadata. The engine's decision to scope is neither. It is
 * `Engine.buildDriverOptions`:
 *
 * ```ts
 * const hasTenant =
 *   execCtx?.tenantId !== undefined && !isTenancyDisabled(objectSchema) && !isFederated;
 * ```
 *
 * — the engine scopes unless the object opts OUT, while seam 2 refuses only an
 * explicit opt-IN. An object that OMITS the `tenancy` block falls between them:
 * the engine scopes it, seam 2 never sees it, and seam 1 passes because the
 * posture really is `single`. A `single` posture constrains the WALL, not the
 * number of organizations, so rows still carry whichever `organization_id` they
 * were written with — and this driver used to discard the scope and answer with
 * EVERY organization's rows. That is the silent non-isolation this whole guard
 * exists to remove, reappearing on the DEFAULT case.
 *
 * Why the gap cannot be closed at seam 1 or 2 — measured, not assumed:
 * `execCtx?.tenantId !== undefined` is a property of the REQUEST, and at
 * `syncSchema` time that fact does not exist yet. Every engine call site spells
 * `syncSchema(tableName, obj)` and `dropTable(tableName)`, so the DDL doors are
 * never handed a `DriverOptions` at all and the scope is structurally invisible
 * there. The refusal has to sit where the scope actually arrives.
 *
 * Widening seam 2 to the engine's own predicate (refuse any object not
 * explicitly opted out) was considered and rejected: it would refuse at BOOT on
 * objects that merely omit the block — including single-organization apps that
 * never carry an organization context and are therefore never scoped. That is
 * wider than the refusal this driver owes. The ruled shape is "refuse when
 * handed a scope", not "refuse a schema that could one day be scoped".
 *
 * ## ⚠️ Every isolation measurement previously taken on this driver is VOID
 *
 * Before #16589 a suite asserting "tenant A cannot see tenant B's rows" passed
 * here trivially — not because isolation worked, but because both tenants' rows
 * came back to every caller and the assertion was written against a single
 * tenant's fixture. Any isolation property measured on `driver-memory` before
 * this refusal landed measured **nothing** and must be **re-taken** on a driver
 * that enforces isolation (`@objectstack/driver-sql`, `:memory:` included).
 *
 * ## Why both boot seams, and not just one
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
const CALL_SEAM_ISSUE_URL = 'https://github.com/objectstack-ai/objectstack/issues/16589';

/**
 * Thrown when the in-memory driver is asked to run in a multi-tenant deployment,
 * or to serve one call under a tenant scope it cannot honour.
 *
 * Carries {@link MULTI_TENANT_UNSUPPORTED_CODE} as `code` so hosts (CLI boot,
 * runtime plugin loader, tests) can recognise it without string-matching the
 * message or relying on cross-realm `instanceof`.
 *
 * ONE error family covers both, deliberately (#16589): the cause is identical —
 * this driver has no row-level tenant isolation — so a host that already
 * recognises the boot refusal recognises the per-call one with no new code and
 * no second code to learn. `seam` varies only the WORDING, never the `code`.
 */
export class MemoryMultiTenantUnsupportedError extends Error {
  public readonly code = MULTI_TENANT_UNSUPPORTED_CODE;

  constructor(detected: string, remedy: string, seam: 'boot' | 'call' = 'boot') {
    const headline = seam === 'boot' ? 'Refusing to start' : 'Refusing to answer';
    const consequence =
      seam === 'boot'
        ? `  read, update and delete OTHER tenants' records. Rather than run unisolated,\n` +
          `  the driver fails at startup.\n`
        : `  answering this call would read, update or delete records belonging to OTHER\n` +
          `  organizations. Rather than answer it unisolated, the driver refuses it.\n`;
    const tracking =
      seam === 'boot'
        ? ISSUE_URL
        : `${CALL_SEAM_ISSUE_URL} (per-call refusal), ${ISSUE_URL} (no isolation here)`;
    super(
      `[driver-memory] ${headline}: this driver has NO row-level tenant isolation.\n` +
        `\n` +
        `  Detected: ${detected}\n` +
        `\n` +
        `  InMemoryDriver never scopes by \`DriverOptions.tenantId\` — reads carry no\n` +
        `  tenant predicate and writes are not stamped with a tenant column, so\n` +
        consequence +
        `\n` +
        `  Fix one of:\n` +
        `    • Use @objectstack/driver-sql (PostgreSQL / MySQL / SQLite) for multi-tenant\n` +
        `      deployments — it enforces tenant scoping at the driver level. For an\n` +
        `      in-process store, \`SqlDriver\` with \`connection: { filename: ':memory:' }\`\n` +
        `      is the closest drop-in replacement.\n` +
        `    ${remedy}\n` +
        `\n` +
        `  Tracking: ${tracking}`,
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
 * {@link assertSingleTenantPosture}).
 *
 * ## ⚠️ Superseded reasoning — kept because it was load-bearing (#16589)
 *
 * This docstring used to close with a second clause, which was **false**:
 *
 * > …and every object in a single-tenant deployment omits the block.
 *
 * It reads "single posture ⇒ one tenant ⇒ nothing to scope", and both halves
 * fail. `single` constrains the **wall**, not the number of organizations: a
 * `single`-posture run was measured holding **13** `sys_organization` rows
 * (twelve seeded by the app, one minted by the platform for the admin), with
 * rows carrying whichever `organization_id` they were written with. And the
 * omission it describes is not the absence of a tenant signal but its default
 * PRESENCE — `Engine.buildDriverOptions` scopes an object unless it opts out,
 * so "omits the block" is precisely the SCOPED case, not the exempt one.
 *
 * The sentence is recorded rather than deleted because it is what justified
 * this predicate being an opt-IN test, and anyone re-reading that decision needs
 * to see the reasoning that was withdrawn. The predicate itself is unchanged and
 * still correct **for what it is used for** — seam 2 refuses an object that
 * DECLARES isolation. The case the sentence got wrong is not seam 2's to catch:
 * it belongs to {@link assertCallNotTenantScoped}, which judges the scope the
 * engine actually hands over instead of re-deriving it from metadata.
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

/**
 * Refuse a single driver call that arrives carrying the engine's tenant scope.
 *
 * This is seam 3 (#16589). It judges the scope the engine **actually handed
 * over** — `DriverOptions.tenantId` / `tenantIds` — rather than re-deriving the
 * engine's predicate from object metadata. That distinction is the whole point:
 * the engine's own reasons for scoping (an `ExecutionContext` tenant, the
 * object's ADR-0066 posture, whether the object is federated) stay in the
 * engine, and this driver refuses on the one observable fact it can see without
 * guessing. A driver that re-derived the predicate would drift from it the first
 * time the engine's reasoning changed, and drift here is silent exposure.
 *
 * Three cases follow from that, and they are what makes the refusal narrow:
 * - object omits `tenancy` + a caller with an active organization → the engine
 *   sends `tenantId` → **refused** (this is the #16589 defect);
 * - object declares `tenancy.enabled: false` → the engine sends no `tenantId`
 *   (ADR-0066, `isTenancyDisabled`) → served unchanged;
 * - no organization context at all → no `tenantId` → served unchanged, which is
 *   the ordinary dev / example-app / single-organization path.
 *
 * `tenantIds` (ADR-0105 D2, `group` posture) is checked alongside `tenantId`
 * because the ruling names both. An absent or EMPTY `tenantIds` is not a scope
 * of its own: `DriverOptionsSchema` defines empty as "fall back to `tenantId`
 * equality", so treating `[]` as a scope would refuse calls the engine never
 * scoped.
 *
 * ⚠️ **Call this FIRST in the door, before any store access or delegation.** The
 * refusal must not leave a partial effect behind: `upsert()` delegates to
 * `update()` or `create()`, and a refusal that fell through to the `create` arm
 * would land a SECOND row under one primary id — a defect measured on the
 * closed round of this card. Refusing at the top of the door makes that
 * unreachable, and leaves the store exactly as the call found it.
 *
 * @param operation the driver door being refused, for the message (`find`, …)
 * @param object    the object the call names
 * @param options   the `DriverOptions` as received (may be undefined)
 */
export function assertCallNotTenantScoped(
  operation: string,
  object: string,
  options: unknown,
): void {
  const opts = options as { tenantId?: unknown; tenantIds?: unknown } | null | undefined;
  const tenantId = opts?.tenantId;
  const rawIds = opts?.tenantIds;
  const tenantIds = Array.isArray(rawIds) ? rawIds.map((id) => String(id)) : [];

  if (tenantId === undefined && tenantIds.length === 0) return;

  const union = tenantIds.map((id) => `\`${id}\``).join(', ');
  const scope =
    tenantIds.length > 0
      ? `\`tenantIds\` = [${union}]` +
        (tenantId !== undefined ? ` (active \`tenantId\` \`${String(tenantId)}\`)` : '')
      : `\`tenantId\` = \`${String(tenantId)}\``;

  throw new MemoryMultiTenantUnsupportedError(
    `\`${operation}()\` on \`${object}\` was handed a tenant scope by the engine: ${scope}`,
    '• If this object is genuinely platform-global, declare it so:\n' +
      '      `tenancy: { enabled: false }` (ADR-0066) stops the engine scoping it and\n' +
      '      this driver serves it unchanged. ⛔ Do NOT reach for that to silence this\n' +
      '      refusal on data that really is per-organization — it isolates nothing, it\n' +
      '      declares there is nothing to isolate, which is the very failure this\n' +
      '      refusal exists to surface.',
    'call',
  );
}
