---
'@objectstack/objectql': patch
---

fix(objectql)!: a predicate update judges each matched row against the parent summaries the rows judged before it move, as consecutive by-id updates do

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the summary value a rule reads while one predicate update is judged: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a predicate update (`update(object, patch, { where, multi: true })`, a flow `update_record` step with `multi: true`) of a child object whose validation rule reads a roll-up `summary` of a parent one hop through a reference (`record.inv.primaries > 0`), or whose field-level `requiredWhen` reads one on `parent` (`parent.line_count >= 3`), or that reads a `formula` or stored computed field of the parent calculated from one (`record.project.remaining`, `remaining = budget - spent`). A bulk create and a bulk update already equal one-by-one writes for a rule reading the summary itself (a bulk create does not yet for a rule reading a parent field calculated from one: its accumulator moves the summary key alone, #34821); this extends that to the update that selects its rows by a filter, calculated parent fields included.

- FROM: the matched rows' related parents and master-detail headers were read once, and every row judged the summary as it stood before the update: "one primary line per invoice" (`record.is_primary == true && record.inv.primaries > 0`) refused the second of two lines made primary one by one, and admitted both made primary by one predicate update.
- TO: each matched row judges the summary as the rows judged before it leave it, for `count`, `sum`, `min`, `max` and `avg`, a row moving to another parent included: the base is read in the database (every child as stored for `count` / `sum` / `avg`, the children outside the matched set for `min` / `max`, one grouped aggregate per summary a rule reads) and the matched rows are folded in memory. A parent field calculated from a folded summary is computed again over the parent with the folded value. The update is refused with `VALIDATION_FAILED` and writes nothing, as it does for any refused row. Only an object with such a rule, on an update matching more than one row, reads the base (and, when a calculated field reads a folded summary, the parents' stored rows once).
- The answer moves both ways. Mostly it narrows: main admitted a row that one-by-one refuses, and it is refused now. It also admits a row main refused when the rows judged before it move the summary toward admitting it, as one by one does. For example, with `parent.line_count >= 3` requiring a field, a row leaving that parent lowers the count the later rows read.

**Not moved.** A rule that reads no summary, a predicate update matching one row, a by-id update, hooks and flow steps (they read the value from before the update), and a rule of the parent itself (it judges the summary once, after the write). Three cases keep reading the stored value, as before, and each one covers that summary for EVERY parent the update reads it for, not only the parent that caused it:
- a summary whose `filter` reads through another reference, as a dotted path (`{ 'account.kind': 'x' }`) or in the nested form (`{ account: { status: 'x' } }`), or that the in-memory filter walker refuses;
- a summary meeting a value that is not a number, in any matched row or in any parent's base;
- a `min` / `max` when any one parent holds more than 5,000 matched rows.

The fix for a caller: update the rows the rule refuses on their own, or narrow the filter so the update matches the rows the rule admits.
