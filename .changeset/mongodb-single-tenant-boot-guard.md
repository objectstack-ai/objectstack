---
"@objectstack/driver-mongodb": minor
"@objectstack/cli": patch
---

feat(driver-mongodb)!: declare the driver single-tenant and refuse to boot multi-tenant (#3724)

`MongoDBDriver` implements **no row-level tenant isolation** — it never reads
`DriverOptions.tenantId`, so reads carry no tenant predicate and writes are not
stamped with a tenant column. The layer the SQL driver has (`resolveTenantField`
+ `applyTenantScope`) simply does not exist here, while everything above the
driver — object metadata's `tenancy` block, `applySystemFields` injecting
`organization_id`, the engine threading `tenantId` into every driver call —
operates on the assumption that tenant isolation is a platform guarantee. Point
a multi-tenant deployment's datasource at Mongo and every query read, updated
and deleted other tenants' documents, silently.

Rather than serve unisolated, the driver now fails fast at startup:

- The **constructor** and `connect()` call `assertSingleTenantPosture()`, which
  refuses any tenancy posture other than `single` (`OS_TENANCY_POSTURE=group` /
  `isolated`, including the posture derived from `OS_MULTI_ORG_ENABLED=true`),
  resolved through the shared `resolveTenancyPosture()` so the driver can never
  disagree with auth / the registry / the CLI about the mode. The check sits in
  the constructor because that is the earliest seam — it fails before a host can
  hand the driver anywhere — and `connect()` re-checks in case a host flips the
  posture in between. (It originally had to live in the constructor because
  `ObjectQLEngine.init()` *caught* a driver's connect rejection and booted
  anyway; that is fixed in the same release, #3741, so both seams abort boot.)
- `syncSchema()` / `syncSchemasBatch()` call `assertObjectsNotTenantScoped()` and
  refuse objects declaring `tenancy.enabled: true`, naming every offender in one
  message.
- `objectstack serve` / `dev` (CLI) now re-throw this error out of the
  auto-driver-registration block instead of swallowing it, so boot exits 1 with
  the actionable message — the same treatment `UnsupportedDriverError` already
  gets. Matched duck-typed by `code`, so the CLI takes no dependency on the
  driver package.

Both throw `MongoDBMultiTenantUnsupportedError` with
`code === 'MONGODB_MULTI_TENANT_UNSUPPORTED'`, a message that names the detected
signal, the remedy, and `@objectstack/driver-sql` as the multi-tenant option.

There is deliberately **no override env var**: an escape hatch would restore
exactly the silent non-isolation this guard removes. Single-tenant deployments —
every currently-working Mongo deployment — are unaffected.

This is option B of #3724. Implementing real row-level isolation (option A)
remains open; the `unique` index shape stays single-field until then, which is
now correct by construction rather than by omission.
