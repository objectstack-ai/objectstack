---
'@objectstack/objectql': patch
---

fix(objectql): a multi-row insert judges a rule reading a parent field calculated from a roll-up as one-by-one inserts judge it

Clause-②: no
Metadata-protocol: none

A multi-row insert already moved a parent roll-up (`count`, `sum`, `min`, `max`) by the rows of the batch admitted before each row, for a rule reading it through a reference or a field-level `parent.` predicate. A formula or stored computed field of that parent built on the roll-up (`remaining = budget - total`) still read its stored value, so "a line may not exceed the remaining budget" admitted a third line of 40 against a budget of 100 in one call and refused it one at a time. The write now computes those fields over the moved roll-ups, as a predicate update already did, carrying the parent's stored image from row to row as each recompute stores it. Only a batch with a rule reading that parent pays the one extra read of its parent rows.

The insert accumulation also leaves out a roll-up whose `filter` reads a related record in the nested form (`{ account: { status: 'x' } }`), as it already left out the dotted form and as the predicate update leaves out both.

A predicate update (`multi: true`) whose patch writes no foreign key, source field or filter field of a roll-up its rules read no longer aggregates a base for it: its rules read the stored value, as the by-id update does, with no aggregate read. Each roll-up a predicate update leaves unfolded now logs one debug line naming the object, parent, field and reason (`filter`, `not_a_number`, `exclusion_budget`).

The multi-row insert preview (`validate` with `mode: 'insert'`) does not yet compute these parent fields over the moved roll-ups.
