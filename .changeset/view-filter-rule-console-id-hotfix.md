---
'@objectstack/spec': patch
---

**A view filter rule carrying the console's UI row `id` no longer 422s (#5114).**

`ViewFilterRuleSchema` had been closed to unknown keys by an earlier strictness
wave. The filter builder the console renders stamps `id: crypto.randomUUID()` on
every filter row it creates (a React list key), and the metadata write path
validates the PUT body and then persists the **authored** body verbatim — so the
`id` is on the wire, and in already-stored view rows. Closed, the schema rejected
it: every filter write carrying one came back `422 Unrecognized key(s) on this
view filter rule: 'id'`. Measured on all three paths, including the flattened
personalization overlay that is the shape the console PUTs.

⚠️ **This does not on its own restore "save a filter from the console".** Browser
verification found a second, independent defect stacked on the same request: the
list toolbar persists the filter builder's whole `FilterGroup` object (`{ id,
logic, conditions }`) into `filter`, where the spec declares `ViewFilterRule[]` —
a type mismatch that rejects before the `id` is ever reached. That one belongs to
the producer and is tracked separately; until it lands, the console's filter save
still fails. What this change fixes is every writer that sends a well-formed
`ViewFilterRule[]` whose rows carry the UI `id` — including view rows already
stored with one.

The shape is reopened (unknown keys are dropped again, as before the closure).
`id` is deliberately **not** declared: it is a UI artifact, and declaring it would
put it on the authorable surface and tell an AI author to generate a UUID for a
filter rule. Nothing else changed — the operator vocabulary, the legacy-spelling
normalization and the required `field` all still validate, so an invented operator
is still rejected.

Worth knowing for anyone tightening a neighbouring block: **`.strip()` does not
recurse**, any more than `.strict()` does. `ViewMetadataSchema` re-opens its
flattened members so Studio's round-trip keys ride along, but that re-opens the
top level only — a nested block closed inside the list view is still reached
through that member, so a console-stamped key inside it 422s regardless. The
durable fix is the authoring/wire split tracked in #5074, which this site is now
named in; the verdict is recorded on the schema, in
`view-filter-rule-wire-id.test.ts`, and in the `ui/` row of the strictness ledger.
