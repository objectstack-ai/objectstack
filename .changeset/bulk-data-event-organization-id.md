---
"@objectstack/spec": minor
---

feat(spec): `BulkDataEvent` names the one organization a predicate write's affected records belong to

The realtime `BulkDataEvent` payload (`@objectstack/spec/api`, the body of every
`data.records.updated` / `data.records.deleted` event) gains an optional
`organizationId`: the organization every record the predicate write affected
belongs to — one organization for the whole batch, never per-row and never a
list. It takes the same spelling, the same position beside the match term
`object`, and the same refusal of the empty string as `DataEvent`'s
`organizationId`, so a tenant-scoped consumer discriminates both event families
on one key with one comparison — never a partition of the batch.

Why one organization can be honest on a batch that names no rows: a predicate
write reaches the driver with the security layer's tenant wall AND-composed
onto the caller's filter first (under `isolated` an equality on the caller's
active organization; under `group` membership in the caller's organization
set), and nothing in business RLS or sharing can widen it. When that wall names
exactly one organization, every affected row belongs to it, and the producer
can state so from what it already holds.

What a consumer may assume — and where this deliberately diverges from
`DataEvent`:

- **Present** — every record the write affected belongs to exactly that
  organization. Never fabricated, and never the caller's active organization
  standing in for the rows'.
- **Absent** — the producer did not assert one organization for the batch: every
  event on a `single`-posture deployment; a system, environment-wide or
  cross-membership predicate write; any write whose affected rows are not known
  to belong to one organization. A bulk event names no rows, so absence is a
  statement about the producer's knowledge, not about the rows. It is NOT
  `DataEvent`'s reading "belongs to no organization, not behind any wall". A
  tenant-scoped consumer (a per-organization webhook subscription, a
  per-organization realtime subscriber) must treat an absent key as not
  attributable to its organization and must not deliver the event inside an
  organization wall; a deployment-wide consumer may use it.

Declared = enforced: the key is optional and nothing else. No default
fabricates a tenant; `null` and the empty string are refused with a located
issue, so "not asserted" has exactly one spelling — the key is absent.

Additive and shape-preserving: every bulk event that parsed before parses
identically, and no producer emits the key yet — the ObjectQL engine's bulk
publish site is a separate change that follows this contract. `DataEvent` and
`MetadataEvent` are unchanged.
