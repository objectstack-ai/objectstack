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
context (no wall composed), on a multi-membership `group` sweep, on an object
the wall does not key on, when no enforcement layer injected a posture, and
when the caller may have crossed the wall as a `PLATFORM_ADMIN` or carries no
resolved posture rung. `absent` here means "the producer did not assert one
organization for the batch", deliberately NOT the `DataEvent` reading
"belongs to no organization".

`patch`, not `minor`: the contract surface widened with the spec half (at
`minor`); this change makes the producer honour a key that surface already
declares, adds no export or API shape, and follows the level the single-record
producer half landed at.
