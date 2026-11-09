---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation says a flow's record nodes treat a computed filter operand as a value, never as a query operator

Clause-②: no
Metadata-protocol: none

- **Now.** § Filter operands states the rule from the service-automation change: a computed operand is a string, number, bigint, boolean or date, or at an `$in` / `$nin` / `$between` comparand a list of them with no empty entry. Anything else fails the node as a guard before the query runs. The fix: make the expression evaluate to the compared value (for a record, its `id`), and write conditions in the filter itself. The table of failures a `fault` edge does not route now names that refusal beside the `null` operand.
- `SKILL.md` stays under its token ceiling (no ceiling moves). No schema, key, command or behaviour changes.
