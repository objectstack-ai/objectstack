---
'@objectstack/cli': minor
'@objectstack/driver-sql': minor
'@objectstack/driver-turso': minor
'@objectstack/objectql': minor
'@objectstack/lint': patch
'@objectstack/spec': patch
---

feat!: an organization-less row on a tenant table no longer draws its autonumber from the `__global__` counter, and a production server boot with no auth secret is refused

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (runtime-export-retired @objectstack/objectql#GLOBAL_TENANT) The one author-reachable removal is a runtime export: the string constant `GLOBAL_TENANT` leaves `@objectstack/objectql`'s published entry. No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone; the two run-time narrowings (the driver's counter, `os serve`'s boot) carry their own remedy below. -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D9, stage 8d).

- **`os serve`: a production server boot whose auth did not compose for a missing secret is refused.** With the `auth` tier on and no `OS_AUTH_SECRET` (outside `--dev`), `serve` used to skip AuthPlugin with a warning and serve anyway. That boot had no security model: anonymous object data is always denied, so its data API was unusable. It also had no organization object, so its inline seed wrote rows with `organization_id` NULL and drew their autonumbers from the `__global__` counter. Measured on `examples/app-showcase` before this change: health 200, two NULL-organization rows and a `__global__` counter row on a fresh install. The boot now stops before the kernel starts, so nothing is written, and the message names both fixes. Unchanged: `--no-server` (kernel only) still boots with the warning, a development boot still uses its fallback secret, and the cloud host kernel (`ObjectOSEnvironmentPlugin`, where auth is each project's) still only warns. `os start` never reaches the refusal: it always supplies a secret to the `serve` child it spawns.
- **`@objectstack/driver-sql` (and `@objectstack/driver-turso`'s remote face, which calls the same rule): the counter refuses an organization-less row on a tenant table.** Wherever the driver registered the organization object (`sys_organization`), a `create` / `bulkCreate` / `upsert` on an object with a tenant column, whose row carries no organization and whose options carry no `tenantId`, is refused with `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` (status 500), the code the engine already answers for the same write. It is refused before any counter row is read or written, and nothing is written. New exports: `OrganizationlessCounterRefusal`, `ORGANIZATIONLESS_COUNTER_REFUSAL_CODE`, `ORGANIZATIONLESS_COUNTER_REFUSAL_STATUS`, `renderOrganizationlessCounterRefusal`. Unchanged: `__global__` stays the counter key of an object with no tenant column, and of a composition that registers no organization object on the driver (a lean `@objectstack/objectql/core` embedding), where no organization can exist. Counter rows a 17.x install filed under `__global__` for a tenant table stay in `_objectstack_sequences`; the counter no longer reads them, and `os migrate duplicates` still reports them.
- **`@objectstack/objectql`: `GLOBAL_TENANT` is no longer exported**, and `SystemWriteOrganizationRequiredError`'s message no longer describes the `__global__` counter as where the write would land. The code, status and fields are unchanged.
- **Texts.** The lint explanation of `unique/legacy-organization-composite`, the `UniqueScopeSchema` TSDoc and the error-code ledger now say that a NULL-organization row is residue an earlier release wrote, not something a new write produces.

**The remedy.**
- A production boot refused for the missing secret: set `OS_AUTH_SECRET` (a long random value, identical across restarts and nodes), or run kernel-only with `--no-server`.
- A direct driver write refused by the counter: carry the organization — `driver.create(object, { ...row, organization_id: orgId })` or `driver.create(object, row, { tenantId: orgId })` — or write through the engine, which derives it under `single`.

The retired export:

- FROM `GLOBAL_TENANT` TO `GLOBAL_TENANT` imported from `@objectstack/driver-sql`, where the counter and the index emitters keep it (or the literal `'__global__'`).
