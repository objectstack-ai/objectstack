---
'@objectstack/service-automation': patch
---

fix(service-automation)!: a flow's record nodes treat a computed filter operand as a value, never as a query operator

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. A flow definition the save doors accept is accepted as before; what narrows is the run-time value a `get_record`, `update_record` or `delete_record` node takes from an evaluated filter operand. There is no stored row or authored key for `objectstack migrate meta` to rewrite and no tombstone. -->

**The rule.** A flow's record nodes (`get_record`, `update_record`, `delete_record`) treat an evaluated value in a filter's operand position as a value, never as a query operator: a value that is not a scalar (or a list of scalars where the operator takes a list) is refused before the query runs.

- **A value.** A string, a number, a bigint, a boolean or a date. At the comparand of `$in`, `$nin` or `$between`, a list of them with no empty entry.
- **Refused.** Anything else an operand expression evaluates to (an object, a list where one value belongs, a list holding anything but values, a list with an entry that is nothing), at every operand position and under every key, whatever the value came from. The node fails as a guard before the data engine is asked, and the message names the node, the expression and the operand's place in the filter.
- **Unchanged.** The filter the author wrote: its fields, operators and `$and` / `$or` / `$not` conditions, and every literal operand. An operand that evaluates to nothing is refused as before.

**BREAKING** for a flow that hands a computed object or list into a filter operand where the rule above refuses it: it now fails at that node. Make the expression evaluate to the value the condition compares against (for a record, read its `id`), and write any condition the flow needs in the filter itself.
