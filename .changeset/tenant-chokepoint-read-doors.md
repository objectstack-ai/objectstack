---
'@objectstack/driver-sql': patch
'@objectstack/driver-sqlite-wasm': patch
'@objectstack/driver-turso': patch
---

drivers: every SQL read door routes through the tenant chokepoint (#6792)

`SqlDriver.applyTenantScope()` owns read-side tenant isolation for the whole SQL family —
the `tenantId` early-out, the "object has no tenant field" early-out, the NULL-org
platform-row rule (#2734) and the ADR-0105 D2 union posture (#3623). Its own docstring
said "every CRUD method routes through it". Nothing ever checked that, and it was false
for as long as it had existed. **Three** read doors built their query through
`getBuilder()` and never arrived:

- **`findWithWindowFunctions()`** — the documented #4286 window door. It returns **rows**,
  so on a deployment where the scope would have applied (`options.tenantId` set, object
  has a tenant field) it returned rows belonging to **every** tenant. Measured with two
  tenants seeded plus one NULL-org platform row: `tenantId: 'org_a'` returned
  `[a1, a2, b1, b2, p1]` here against `find()`'s `[a1, a2, p1]` — another tenant's rows,
  handed over at the driver layer.
- **`analyzeQuery()` / `explain()`** — returns a **plan**, not rows, so this is a smaller
  fix and it is made on its own merits rather than folded into the one above. It is the
  same defect #6577 fixed on these two methods one builder line lower: a plan is only
  worth reading if it explains the statement `find()` would actually run, and a missing
  tenant predicate changes selectivity and therefore which index the planner picks.
  Compiled `select * from account` where `find()` sent the `organization_id` clause.
- **`distinct()`** — returns one column's **values** for every tenant. This one was in no
  card. #6792 states the opposite, listing `distinct` among the scoped call sites; the
  13th read site is `aggregate()`. It was found by measuring the invariant rather than
  re-reading it.

All three now call `applyTenantScope()` beside their `getBuilder()` line, the position
`findRows()` uses. They route through the chokepoint rather than re-deriving a predicate:
a local equality would silently drop NULL-org platform rows (#2734) and collapse group
reads to active-org reach (#3623). Both of the chokepoint's early-outs are inherited
unchanged, so an unscoped admin/seed read (no `tenantId`) and any object without a tenant
field behave exactly as before.

**The durable half is a gate, not the three lines.** `pnpm check:tenant-chokepoint`
(`scripts/check-tenant-chokepoint.mjs`, wired into `.github/workflows/lint.yml`) re-derives
the invariant from the AST across the `SqlDriver` family on every run: a method that builds
through `getBuilder(object, options)` must call `applyTenantScope()` on that builder, or
carry a written exemption. Insert builders are exempt structurally — write-side tenancy is
`injectTenantOnInsert` — rather than by a name list. It is keyed on the **builder** and not
on the method signature, because the signature criterion the card sketches ("takes
`(object, …, options)` and returns rows") misses `distinct` (no `query` parameter) and
`analyzeQuery` (returns a plan). Verified red against the pre-fix tree, red against a
newly-added unscoped door, and silent once that door is scoped.

The chokepoint docstring no longer asserts the invariant; it names the gate that proves it.

If you call these doors directly on a multi-tenant deployment, pass `options.tenantId` as
you would to `find()` — that is what now takes effect. Callers that never passed it are
unaffected; that remains the documented unscoped/admin path.
