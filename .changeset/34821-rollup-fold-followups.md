---
'@objectstack/objectql': patch
---

fix(objectql)!: a multi-row insert judges a rule reading a parent field calculated from a roll-up as one-by-one inserts judge it

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export of the package entry changes shape. What moves is the value a rule reads for a parent formula or stored computed field while one multi-row insert is judged, and the value a predicate update's rule reads for a roll-up its patch cannot move: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a multi-row insert (`insert(object, rows)`, an import batch, `insertMany`) of a child object whose validation rule, or field-level `requiredWhen` on `parent`, reads a `formula` or stored computed field of the parent calculated from a roll-up `summary` (`record.bud.remaining`, `remaining = budget - total`).

- FROM: the batch moved the parent roll-up itself by the rows admitted before each row, but a parent field calculated from it kept its stored value: "a line may not exceed the remaining budget" (`record.amount > record.bud.remaining`) refused the third line of 40 against a budget of 100 written one by one, and admitted all three written in one call.
- TO: the field is computed again over the moved roll-ups, as a predicate update already computes it, carrying the parent's stored image from row to row as each one-by-one recompute stores it. The batch is refused with `VALIDATION_FAILED` and writes nothing, as for any refused row; the insert preview (`validate` with `mode: 'insert'`) answers the same row invalid. Only a batch with a rule reading that parent pays one read of its parent rows.

The insert accumulation also leaves out a roll-up whose `filter` reads a related record in the nested form (`{ account: { status: 'x' } }`), as it already left out the dotted form and as the predicate update leaves out both.

A predicate update (`multi: true`) whose patch writes no foreign key, source field or filter field of a roll-up its rules read no longer aggregates a base for it: its rules read the stored value, as the by-id update does, with no aggregate read. Each roll-up a predicate update leaves unfolded now logs one debug line naming the object, parent, field and reason (`filter`, `not_a_number`, `exclusion_budget`).

The fix for a caller: insert the rows the rule refuses on their own, or split the batch so each part fits the rule.
