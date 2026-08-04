---
'@objectstack/spec': patch
---

**Saving a view filter from the console no longer 422s (#5114).**

`ViewFilterRuleSchema` had been closed to unknown keys by an earlier strictness
wave. The filter builder the console renders stamps `id: crypto.randomUUID()` on
every filter row it creates (a React list key), and the metadata write path
validates the PUT body and then persists the **authored** body verbatim — so the
`id` is on the wire. Closed, the schema rejected it, and every filter write that
went through the builder came back `422 Unrecognized key(s) on this view filter
rule: 'id'`. Measured on all three paths, including the flattened personalization
overlay that is the body the console actually PUTs.

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
