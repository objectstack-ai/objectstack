---
'@objectstack/driver-memory': minor
---

The in-memory driver now honours `DriverOptions.tenantId` / `tenantIds` instead of discarding them, so a scoped read no longer returns other organizations' rows.

Two predicates decided "is this object tenant-scoped" and they disagreed on the default case. `Engine.buildDriverOptions` scopes unless the object opts OUT (`tenantId !== undefined && !isTenancyDisabled(schema) && !isFederated`); this driver's boot guard refuses only an explicit opt-IN (`tenancy.enabled === true`). An object that omits the `tenancy` block — the common case — was therefore scoped by the engine and invisible to the guard, and the driver did nothing with the scope: `tenantId`, `tenantIds` and `organization_id` occurred nowhere in `memory-driver.ts`. The read path knew nothing about tenants; the unique-constraint path did.

Measured on one app across two drivers, same build, same seed, same account: the four objects that omit the block returned 12 / 30 / 40 / 14 rows on this driver against **0** on sqlite, and the three that declare `tenancy.enabled: false` agreed exactly. The split line was the declaration. Neither driver said a word about the disagreement.

⚠️ **Every isolation measurement previously taken on this driver is void and must be re-taken.** The failure direction was toward exposure in the place where isolation is tested: a suite asserting "tenant A cannot see tenant B's rows" passed here not because isolation worked, but because both tenants' rows came back to everyone and the assertion had been written against a single tenant's fixture.

The semantics are `driver-sql`'s, read off `applyTenantScope` and reproduced arm for arm rather than invented — `col = :tenantId OR col IS NULL` for the equality path, `col IN (…) OR col IS NULL` under the ADR-0105 D2 union posture, and the NULL arm keeps the #2734 global-row carve-out so a platform row that belongs to no organization stays visible to all of them. Every door that accepts a `DriverOptions` routes through one chokepoint: `find`, `findOne`, `count`, `aggregate` (both arms), `update`, `upsert`, `delete`, `updateMany`, `deleteMany`, `bulkUpdate` and `bulkDelete`. `distinct()` accepts no `DriverOptions` at all and is therefore still unscoped — the one door named rather than left to be discovered.

**What changes for an existing consumer.** A caller that passes no `tenantId` — every seed script, admin path and legacy call — is unaffected down to the array it allocates. A caller that does pass one, on an object carrying a tenant column and no `tenancy` declaration, now sees its own organization's rows plus organization-less rows, where it previously saw everything. That is the fix, and it is the reason a `single`-posture deployment is affected at all: `single` constrains the wall, not the number of organizations — one measured run held 13 `sys_organization` rows.

Write-side tenancy is deliberately not included: nothing stamps a tenant column on insert the way `SqlDriver.injectTenantOnInsert` does, so the boot guard still refuses a walled posture and still refuses an object declaring `tenancy.enabled: true`. `declaresTenantScope`'s docstring is corrected in the same change — its load-bearing sentence, "every object in a single-tenant deployment omits the block", was false.
