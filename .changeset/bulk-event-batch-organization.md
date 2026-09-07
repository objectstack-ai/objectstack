---
"@objectstack/objectql": patch
---

fix(objectql): a published `BulkDataEvent` now names the ONE organization the tenant wall named for the batch

`BulkDataEventSchema.organizationId` (`@objectstack/spec/api`, declared by the
contract half) is one organization for a whole predicate write, or absent. The
only bulk producer — `publishBulkDataEvent`, behind the `multi: true` branches
of `update()` / `delete()` — never set it, so every `data.records.updated` /
`data.records.deleted` event read "not asserted" and a tenant-scoped consumer
could deliver nothing per organization on the bulk path. This is the bulk half
of the cross-tenant webhook fan-out leak; the single-record half (`DataEvent`)
landed separately.

The producer now stamps the key from what it already holds — no second query
on the publish path: under `isolated` the caller's active organization (the
Layer 0 wall's equality term), under `group` the caller's membership set when
it names exactly one organization. It is OMITTED — never the caller's active
organization standing in — on a `single`-posture deployment, on an `isSystem`
context (no wall composed), on a multi-membership `group` sweep, when no
enforcement layer injected a posture (the `OS_TENANCY_POSTURE` env fallback is
deliberately not consulted), when the caller may have crossed the wall as a
`PLATFORM_ADMIN` or carries no resolved posture rung, and on an object the wall
does not key on. `absent` here means "the producer did not assert one
organization for the batch", deliberately NOT the `DataEvent` reading
"belongs to no organization".

Which objects "the wall does not key on", stated exactly rather than claimed as
a mirror: plugin-security's Layer 0 composes no wall when its `tenancyDisabled`
input is true or the object carries no `organization_id`, and it folds THREE
clauses into `tenancyDisabled` — `tenancy.enabled === false`,
`systemFields.tenant === false`, and the deployment's `platformGlobalObjects`
carve-out. The producer reads the registry's binding of that predicate
(`carriesTenantScopeColumn`: the first two clauses plus the column clause) and
answers absent on a federated (`external`) object; a custom
`tenancy.tenantField` is therefore not an exit by itself — the object is walled
iff it carries `organization_id`, and the key follows the wall. The third
clause is deployment-declared and not readable by the engine: a
deployment-exempted object under an armed wall is still stamped with the
caller's organization by this producer alone, and that population's exact
answer is decided by the seam ruled on in #15706.

`patch`, not `minor`: the act adds no member to this package's published
surface. `carriesTenantScopeColumn` is exported at module level inside
`registry.ts` only — `@objectstack/objectql`'s entries (`.`, `./core`) re-export
named members and never `export *`, so `dist/index.d.ts`, `dist/core.d.ts` and
both entries' runtime export lists are unchanged (measured on the built `dist`,
with a firing control) — and the emitted event's member was declared, typed
and paid for at `minor` by the spec half. Producer conformance to an existing
optional member under `fix(` changes no public surface of this package.
