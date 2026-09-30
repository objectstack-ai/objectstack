---
"@objectstack/spec": patch
---

docs(spec): the `FilterCondition` docblock says the query engine refuses the nested-relation form

`FilterCondition`'s form 4, `{ relation: { field: value } }`, stays in the type and the schema (nothing is narrowed: `FilterConditionSchema` parses it as before), and its docblock now states what the engine answers: `INVALID_FILTER` / 400 on every driver, because no data-path driver follows a relation into the related object. It names the route that works — filter the related object first, then match the relation field against the ids it returns (`$in`, or `$contains` per id on a multi-valued relation). The `QueryFilter` example no longer teaches the form, and the `Filter<T>` nested arm's comment points at the refusal.
