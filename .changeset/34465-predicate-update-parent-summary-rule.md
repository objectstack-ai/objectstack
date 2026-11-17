---
'@objectstack/objectql': patch
---

fix(objectql)!: a predicate update judges each matched row against the parent summaries the rows judged before it move, as consecutive by-id updates do

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the summary value a rule reads while one predicate update is judged: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a predicate update (`update(object, patch, { where, multi: true })`, a flow `update_record` step with `multi: true`) of a child object whose validation rule reads a roll-up `summary` of a parent one hop through a reference (`record.inv.primaries > 0`), or whose field-level `requiredWhen` reads one on `parent` (`parent.line_count >= 3`). A bulk create and a bulk update already equal one-by-one writes for such a rule; this extends that to the update that selects its rows by a filter.

- FROM: the matched rows' related parents and master-detail headers were read once, and every row judged the summary as it stood before the update: "one primary line per invoice" (`record.is_primary == true && record.inv.primaries > 0`) refused the second of two lines made primary one by one, and admitted both made primary by one predicate update.
- TO: each matched row judges the summary as the rows judged before it leave it, for `count`, `sum`, `min`, `max` and `avg`, a row moving to another parent included: the base is read in the database (every child as stored for `count` / `sum` / `avg`, the children outside the matched set for `min` / `max`, one grouped aggregate per summary a rule reads) and the matched rows are folded in memory. The update is refused with `VALIDATION_FAILED` and writes nothing, as it does for any refused row. Only an object with such a rule, on an update matching more than one row, reads the base.

**Not moved.** A rule that reads no summary, a predicate update matching one row, a by-id update, hooks and flow steps (they read the value from before the update), and a rule of the parent itself (it judges the summary once, after the write). A summary whose `filter` reads a dotted path, one meeting a value that is not a number, and a `min` / `max` under a parent with more than 5,000 matched rows keep reading the stored value.

The fix for a caller: update the rows the rule refuses on their own, or narrow the filter so the update matches the rows the rule admits.
