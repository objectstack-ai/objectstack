---
'@objectstack/spec': patch
---

Liveness ledger: `book.json`'s header names the dead row instead of restating counts
that match no reading of the file.

The `_note` opened with *"15 of 17 live; the two dead entries are both inline
`translations` maps"*. Neither half survives a re-read of the ledger it describes: the
file carries **13 live and 1 dead** row across all nesting levels, and the gate's own
report — `check-liveness.mts --json`, `types.book.byStatus`, published in
`liveness/state-counts.md` — reads `live 20 … dead 1 … classified 21`. 15 and 17 appear
in neither granularity. The plural is the half a reader acts on: it sends them looking
for a second dead inline `translations` map that the ledger does not record.

The second dead entry did exist, and it was not lost. `book.translations` was seeded
`dead` next to `groups[].translations` on 2026-08-01 (#4488), and both were retired in
#4667 by two deliberately different routes: the book-level key is a strict deletion, so
it left the walked shape and its ledger row was deleted with it, while the group-level
key is tombstoned (`retiredKey`) because `BookGroupSchema` is a plain `z.object` with no
`.strict()`, where a bare delete would have zod silently strip the key. The README's
`book` row records that disposition in writing, and the gate reports `unclassified: 0`
for the type — every key in the walked shape has a verdict. The ledger was complete; only
the sentence had gone stale, on the day the second key was retired.

The replacement states the boundary — which row is dead, and why its twin carries no row
— and restates no total. Counts belong to `state-counts.md`, which `check:liveness`
proves fresh on every run; a fresh pair of integers in a Notes cell is the next
occurrence waiting to happen.

No `status` value moves and no schema changes: this is the header prose only.
