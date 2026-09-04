---
"@objectstack/spec": patch
---

`view/row-color-without-colors` — a new author-time completeness warning for a `rowColor` block that colours nothing

`RowColorConfigSchema` requires `field` and leaves `colors` optional, so a list view
authored as `rowColor: { field: 'status' }` parses, publishes and colours no row: the
only renderer that reads the block needs BOTH keys, and its row-className resolver
returns before it reads a record when the map is missing. Every key involved is a
declared, live one, so neither unknown-key rejection nor the liveness ledger could see
it — the ADR-0078 silent half, in the family `validateFunctionalCompleteness` already
gates (a `summary` with no `summaryOperations`, a `select` with no `options`).

`checkViewCompleteness` now emits a `warning` finding at `rowColor.colors` when a grid
list view binds a non-empty `rowColor.field` and declares no usable `colors` map. Both
spellings of "no map" are flagged — `colors` absent, and `colors: {}`, which passes the
renderer's own guard and then matches no value, so it is the same dead shape spelled
out. The finding names the view, the bound field and the runtime line that makes it
true, and prescribes the map.

The accept set does not move: `colors` stays optional and nothing is added, removed or
narrowed. Only the diagnostic is new, plus a rewritten `.describe()` on
`RowColorConfigSchema.field` that no longer reads as if a colour is derived without a
map.

Scope is measured, not assumed: the rule fires only on the view type whose renderer
actually reads `rowColor` (the grid branch of the list-view adapter's per-type props
switch). On a kanban or gallery view the block is inert too, but for a different
reason — the key is never forwarded there at all — so prescribing a `colors` map would
be a false prescription. That is recorded in the module, not enforced.
