---
"@objectstack/spec": minor
"@objectstack/rest": minor
---

`GET /api/v1/meta/:type/:name` serves a per-column sortability projection
beside every object document (#10235, 2026-08-23 ruling, option A: the
platform serves an explicit signal; grids never re-derive "virtual ⇒
unsortable" from field type). The envelope gains an optional `sortability`
key — present exactly when the served type is `object`, on every branch,
cached included — declared by the new `ObjectSortabilitySchema` /
`resolveObjectSortability` in `@objectstack/spec/api` and computed at serve
time from the served (post-masking) document via the spec's own storage
predicates, so the signal cannot drift from what the runtime doors
(#6994/#7095) refuse. The closed category set: an unknown name and a dotted
path are encoded as ABSENCE from the projection (both refused `400
INVALID_SORT`), a virtual-type field (`SEARCH_VIRTUAL_TYPES` — `formula`
today) answers `sortable: false, reason: 'virtual-type'` (refused at both
doors), and a platform-injected anchor on an ADR-0015 `external` object with
no storage behind it stays `sortable: true` with
`caveat: 'unprovisioned-anchor'` (accepted by the doors, measured to degrade
silently when the remote lacks the column — #10474). `summary` and
`autonumber` stay sortable: virtuality is the storage predicate, never the
write contract. The projection is deliberately NOT an authorable key — the
served document is untouched. Consumer leg (the grid dropping the sort
affordance where the signal says unsortable) is objectui#5729.
