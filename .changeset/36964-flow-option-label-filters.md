---
'@objectstack/lint': patch
---

fix(lint): `os validate` refuses an option label in a flow's query filter, edge condition or decision branch

Clause-②: no
Metadata-protocol: none

A select field stores the option's value, never its label, and a flow hands its filters and conditions to the data engine and the expression engine as written: nothing resolves a label to its value there. So `filter: { stage: 'Closed Lost' }` on a `get_record`, `update_record` or `delete_record` step matched no row, and the step reported success having read, updated or deleted nothing; an edge condition or `decision` branch `deal.stage == 'Closed Lost'` was never taken. `os validate` said nothing, because `flow-condition-option-label` read only the start condition.

`flow-condition-option-label` (`error`, as on the start condition) now also reads:

- each operand of a `get_record` / `update_record` / `delete_record` `filter`, and of a time-relative sweep's `timeRelative.filter`: a field's implicit equality, its `$eq` / `$ne` comparand and each member of its `$in` / `$nin` list, at the top level or under `$and` / `$or` / `$not`, at any region depth;
- every edge condition and every `decision` node's `conditions[].expression`, where it compares a select field of the trigger record (`record.F`, `previous.F`, a bare `F` no flow variable shadows) on a record-change or time-relative flow, or of the row a single-row `get_record` step bound to its `outputVariable` (`deal.F`).

The finding names the field, the label and the value to write in its place. A CEL value envelope, a variable or a template is not judged; neither is a field whose options come from a shared picklist, nor a variable that anything else in the flow also binds. A filter that is meant to find rows still holding a label (a clean-up after the options changed) writes the operand as a CEL value envelope, `{ dialect: 'cel', source: "'Closed Lost'" }`. The runtime publish gate runs the same rule, so an active flow write carrying one of these is refused there too.
