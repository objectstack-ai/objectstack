---
"@objectstack/driver-memory": minor
---

feat(driver-memory)!: declare the driver single-tenant and refuse to boot multi-tenant (#6915)

`InMemoryDriver` implements **no row-level tenant isolation** — it never reads
`DriverOptions.tenantId`, so reads carry no tenant predicate and writes are not
stamped with a tenant column. The layer the SQL family has (`resolveTenantField`
+ `applyTenantScope`) does not exist here at all, which is why
`scripts/check-tenant-chokepoint.mjs` scans `driver-sql` / `driver-sqlite-wasm` /
`driver-turso` and not this package — and `distinct(object, field, query?)` does
not even accept a `DriverOptions`, so a caller has nowhere to pass a tenant even
deliberately.

Everything above the driver assumes tenant isolation is a *platform* guarantee
(object metadata's `tenancy` block, `applySystemFields` injecting
`organization_id`, the engine threading `tenantId` into every driver call). So a
multi-tenant deployment backed by this driver did not fail — it served
cross-tenant reads, updates and deletes **silently**, the "declared ≠ enforced"
shape Prime Directive #10 forbids.

It now refuses to run there, at startup, on two signals:

- **Deployment posture** — `assertSingleTenantPosture()` reads the shared
  `resolveTenancyPosture()` resolver (ADR-0105 D1), the canonical knob which also
  subsumes the legacy `OS_MULTI_ORG_ENABLED` boolean, so the driver, auth, the
  registry and the CLI can never disagree about the mode. Both walled postures
  (`group` and `isolated`) need an organization wall this driver cannot draw, so
  both are refused; only `single` passes. Called from the **constructor** and
  re-checked in `connect()`. Both seams are load-bearing: `connect()` is what
  `ObjectQLEngine.init()` turns into a boot-aborting `DriverConnectError`
  (framework#3741), while the constructor is the seam no escape hatch reaches —
  `OS_ALLOW_DRIVER_CONNECT_FAILURE=1` downgrades a connect rejection to a warning
  and would boot the deployment unisolated again.
- **Object metadata** — `assertObjectsNotTenantScoped()` refuses to sync an
  object declaring `tenancy.enabled: true`, naming every offender in one message
  so an operator fixes the whole set in one pass. Called from `syncSchema()`,
  before the table is allocated.

Both throw `MemoryMultiTenantUnsupportedError` with
`code === 'MEMORY_MULTI_TENANT_UNSUPPORTED'`, a message that names the detected
signal, the knobs that produced it, and `@objectstack/driver-sql` (including
`connection: { filename: ':memory:' }` as the closest in-process drop-in) as the
multi-tenant option.

There is deliberately **no override env var**: an escape hatch would restore
exactly the silent non-isolation this guard removes. Single-tenant deployments —
the dev stack, the example apps, `@objectstack/verify`, and every in-process
embedding, none of which set a tenancy posture — are unaffected.

This is option B of #6915, mirroring the guard #3724 landed on
`@objectstack/driver-mongodb`. Implementing real row-level isolation (option A)
stays behind the #5499 investment freeze; a startup refusal is not an investment
in this driver's capabilities, it is the removal of a silent failure mode
(maintainer ruling, 2026-08-12).

Graded `minor` rather than `patch` for the same reason the sibling guard was: a
deployment that boots today can stop booting. It is a refusal that was always
owed, but it is still a behavior change, and the release notes must be able to
say so.
