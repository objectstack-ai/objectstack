---
"@objectstack/service-storage": patch
---

fix(service-storage): stamp the acting organization on the last two `sys_file` insert doors (#13547)

`sys_file` declares no `tenancy` key, so `isTenancyDisabled()` reads `false`
and the registry provisions `organization_id` on it. Four doors on the object
had been given the acting organization one card at a time — `createFile`
(#12745), `createSession` (#12928), and the `update`/`delete` halves (#13178) —
and all four run through `StorageMetadataStore`, which threads a
`StorageWriteContext` into `context.tenantId` so the platform's insert-side
chokepoint can stamp the column.

Two doors bypassed that store entirely and carried no organization at all:

- `copyOwnedFile` (`file-reference-lifecycle.ts`) — the copy-on-claim
  lifecycle hook, which inserts a fresh `sys_file` whenever a record writes an
  id already owned by another field slot;
- `materializeDataUri` (`backfill-file-references.ts`) — the operator backfill
  pass, which inserts one `sys_file` per inline `data:` URI it converts.

Both passed `{ isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true }`, so
`buildDriverOptions` emitted no `DriverOptions.tenantId`,
`SqlDriver.injectTenantOnInsert` had nothing to stamp from, and every row
landed `organization_id = NULL`. The driver's tenant term is
`(organization_id = :tenantId OR organization_id IS NULL)`, so those rows were
reachable from **every** organization — including through the very update and
delete doors #13178 had just scoped.

⚠️ Nothing warned, and the silence was explained rather than reassuring:
`isSystem` also sets `bypassTenantAudit = true`, which is exactly the guard
`auditMissingTenant` returns at — so the `[tenant-audit]` line naming this
defect ("writes will not be tenant-isolated") never fired for either door.

Each door now threads the organization the platform can actually justify, as
an execution context — ⛔ never as a column on the payload, so
`resolveTenantField` / `injectTenantOnInsert` keep deciding whether the object
has a tenant column and whether an explicit value wins:

- the **copy** takes the organization of the write that triggered it, read
  from `HookContext.session.organizationId` (which ObjectQL's `buildSession()`
  copies verbatim from `ExecutionContext.tenantId`);
- the **backfill** takes the organization of the record whose field held the
  bytes, resolved with the same `createWallOrganizationResolver` the `sys_file`
  organization sweep uses, so an object declaring `tenancy.tenantField` is read
  by the column it is really walled by.

Both stamp exactly what that sweep would independently derive from the new
file's field-reference holder, so the forward and repair halves agree by
construction. The backfill needs **no** operator-supplied organization and
deliberately takes none: one run spans every object and organization in the
deployment, so a single supplied value would be stamped onto other tenants'
files — and a wrongly-stamped row is walled into somebody else's tenant, which
is strictly worse than a NULL row that stays reachable.

Where no organization is in scope — a caller with no active org, an unwalled
object, a legacy row that carries none — the `tenantId` key is omitted
entirely and the write proceeds exactly as before. ⛔ Forward-stamping only:
no existing `sys_file` row's organization is written by either door.
