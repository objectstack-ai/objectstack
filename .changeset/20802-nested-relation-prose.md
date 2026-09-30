---
"@objectstack/spec": patch
---

docs(spec): the `FilterCondition` docblock says the query engine serves the nested-relation form in `where`

`FilterCondition`'s form 4, `{ relation: { field: value } }`, now states the served semantics: the engine reads the related object with the condition as the caller (its row scope and field permissions apply), matches the relation field against the ids it returns (`$in`, or any member on a multi-valued relation), reaches one level, and refuses a condition matching more related records than its cap rather than truncating. The `QueryFilter` example shows the form again, and the `Filter<T>` nested arm's comment says the engine serves one level. The type and the schema are unchanged.
