---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
---

feat(spec): `@objectstack/spec/data` exports `isListComparandOperator`, and a flow's record nodes read it instead of a local copy of the list operators

Clause-②: yes
Metadata-protocol: none

- **`@objectstack/spec/data`** now exports `isListComparandOperator(op)`: `true` exactly for the field operators whose declared comparand is a list (`$in`, `$nin`, `$between`), `false` for every other spelling. It reads the same split the comparand-type and comparand-shape faces judge with, so a consumer that judges a comparand by its operator no longer keeps its own copy. The two operator sets behind it stay unexported.
- **`@objectstack/service-automation`**: the `get_record`, `update_record` and `delete_record` nodes decide where an evaluated list is accepted in a filter with that predicate. Which operands are accepted or refused is unchanged.
