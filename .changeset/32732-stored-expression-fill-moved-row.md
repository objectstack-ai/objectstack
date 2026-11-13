---
'@objectstack/objectql': patch
---

fix(objectql): the stored-expression fill judges a row another write moved mid-walk again, under the definition live now, instead of counting it as computed

Clause-②: no
Metadata-protocol: none

The fill that `os migrate stored-expressions --apply` runs, and that a save or publish runs when a stored computed field computes something new, writes each row only while it still holds the `updated_at` the walk read. A row another write changed in between was skipped and counted as computed by that write. That holds for an engine write on a node already serving the new definition, and not for a peer node that has not applied the change yet or a write that did not go through the engine: such a row kept a NULL or the old expression's value, and the answer could still say nothing was left. Now the fill reads the moved row again and judges it by the walk's own predicate under the live definition. A row that holds the value is left alone and counted under `concurrentRows`; a row that does not is written under its new stamp, with the same precondition; a row that moves again before that write lands, or that holds a value a field which does not evaluate there would erase, is listed under `failures`, so the save or publish answers `stored-expression-fill-incomplete` and the command exits 1. A driver whose conditional write never matches the stamp it reads back still falls back to an unconditional write, and the run now warns once per object that the guard is off there.

`concurrentRows` is a required member of the exported `StoredExpressionBackfillReport` and `StoredExpressionBackfillFieldOutcome` types (and so of the command's `--json` report) since the fill's writes became conditional on the stamp the walk read; it counts only rows that, read again, hold what the expression computes now, and a row deleted mid-walk is counted there too.
