---
"@objectstack/rest": patch
---

refactor(rest): retire the public lookup route's `picker.sort` read (#7485)

`GET /forms/:slug/lookup/:field` composed its query with
`sort: picker.sort ?? [{ field: displayFields[0], order: 'asc' }]` — a fifth
read of the `publicPicker` block that #7467's declaration enumerated four keys
for (`displayFields`, `maxResults`, `filter`, `object`). `sort` was in neither
the schema nor the enumeration, so it sat in exactly the state ADR-0049 calls
the mirror-gap: **enforced by the route, declarable nowhere.** The strict block
(ADR-0089 D3a) rejects a form authoring `publicPicker.sort` with
`unrecognized_keys`, so no form written since #7467 has ever reached the read.

The maintainer ruled **retire the read** rather than declare the key: `sort` has
zero measured pull, and declaring it would mean permanently maintaining one more
public knob on an **unauthenticated** search surface. Ordering is now fixed —
the first `displayFields` entry, ascending — and is the only behavior.

**Impact.** None for any form that parses today: the read was unreachable
through the authoring path. A row persisted before #7467 declared the block
(never validated by `ViewMetadataSchema`, so it can carry a `sort` the schema
would refuse now) is **ignored, not an error** — the route reads past it and
answers 200 with the fixed ordering, pinned in
`packages/rest/src/public-form-lookup-picker.test.ts`. If custom ordering is
ever wanted here, the declare fork on #7485 re-runs then; it stays cheap.
