---
'@objectstack/objectql': patch
---

fix(objectql): a predicate delete walks the rows it matches as one set: each relation pointing at the object is asked once per 500 matched rows, not once per row (#27004)

Clause-②: yes (widening) — a predicate delete (`engine.delete(object, { where, multi: true })`, a flow's `delete_record` with `multi: true`) whose matched rows are held only by OTHER matched rows (a report and its manager through a `restrict` self-lookup, both matched) now deletes them; the row-by-row walk refused it, or not, depending on which row it met first. Nothing is narrowed.
Metadata-protocol: none

- **Before.** The predicate delete ran the by-id referential walk once per matched row, so its cost was matched rows times referencing relations: 1,001 rows of an object three relations point at took 4,004 dependents probes, about 1.7 s on SQLite.
- **Now.** One walk, rooted at the whole matched set (a by-id delete is a set of one). Each referencing relation is probed once per 500 matched rows with `$in` (a multiple lookup ORs each id's `$contains`), and each row is then judged and written as before: `restrict` refuses, `cascade` deletes (each child through its own delete, hooks and all), `set_null` clears, a multiple lookup loses only the deleted members and an emptied set is written as `[]`. The same 1,001-row delete takes 12 probes.
- **Unchanged.** A refusal's code and wording: it still names one record and counts the rows that refuse over that record (for a required multiple lookup, the rows the removal would empty). The atomic and split plans, the 500-id `$in` delete batches, the roll-up recompute after the delete, and the filter of every probe a by-id delete sends.
- **Who sees it.** A bulk delete that removes rows holding each other: a matched row that another matched row holds is in the delete's own set, so it neither refuses nor is cleared first (the rule a cascade already applies to the rows it deletes). A holder outside the matched rows still refuses.
