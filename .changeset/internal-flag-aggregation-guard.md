---
"@objectstack/objectql": patch
---

fix(objectql): the aggregate guard now refuses `internal: true` columns, not just the `secret`/`password` TYPES (#7922)

`aggregate()`'s fail-closed guard (`rejectCredentialAggregation`, ADR-0100 /
#3171) decided what to refuse by asking `collectCredentialFields` — a collector
keyed on the field **TYPE**. That left it blind to exactly the channel #7728
had just given the read path a way to protect.

ADR-0100's third credential channel is an auth-subsystem one-way hash living in
an ordinary `text` column (`sys_api_key.key`). No type-keyed collector can ever
reach it, which is why #7728 minted the type-independent `internal: true` flag —
*"the declared value is never returned on the generic data path"* — and taught
`find` / `findOne` / the 201 create body / the by-id update body to omit it.

The aggregation guard was never taught the same thing. So the read path
understood "protected by flag" while the guard still only understood "protected
by type", and a flagged column that `find` omitted could be named as a `groupBy`
dimension or a MIN/MAX measure and come back as the group key itself — the
promise in the flag's own declaration stopping at the edge of `aggregate()`.

The guard now takes the **union** of the two collectors, deduped, so both the
type-keyed and the flag-keyed sets are refused. Composition happens at the call
site: the collectors stay separate because their other consumers answer
differently — the read path MASKS a credential type and OMITS a flagged field,
and a flagged column must never acquire a mask.

**Nothing is disclosed by this today, and this is not a security fix.** There is
no `/data/:object/aggregate` route and analytics requires a declared dataset, so
no reachable caller could reach the gap. It is closed because the inconsistency
is what bites the next adopter: `sys_api_key.key` is a SHA-256 hash, but
`sys_session.token` (#7823) is a live bearer credential, and the flag reads as
though it already covered both.

**Unchanged.** An unflagged column still aggregates normally — including an
ordinary column sitting on the same object as a flagged one, and `COUNT(*)` over
an object that merely *has* one. Neither collector has a `managedBy` exemption,
so the union does not acquire one, and the read-path behaviour from #7920 is
untouched: `sys_api_key.key` still authenticates through `where: { key: <hash> }`
and still mints show-once.
