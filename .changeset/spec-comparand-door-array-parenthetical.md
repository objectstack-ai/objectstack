---
"@objectstack/spec": minor
---

docs(spec): the comparand door's array parenthetical states what the drivers do today

`filter-comparand-type.ts`'s list of the cases its door deliberately does not rule described the array cell as "`driver-sql` refuses it with its own message; the document stores give it array-equality semantics". Measured on this tree, that second clause is no longer a true statement about `@objectstack/driver-memory`: its reference matcher compared an array comparand by REFERENCE (matching nothing), while its live query path deep-equalled it (matching the row) — one package, two answers, neither of them a stable "array-equality semantics" a reader could build on. With that driver's cell now refused, the sentence names the two dispositions that exist: `driver-sql` and `driver-memory` refuse it, each with its own message, and `driver-mongodb` hands it to MongoDB and inherits that engine's array semantics.

The paragraph's point is unchanged and deliberately kept: the door does not rule this position, the matrix did not measure it, and it is left to the layers that already answer it. Only the description of what those layers do is corrected — a stale factual clause is how the next reader re-derives "the spec promises array-equality" from a passage that explicitly promises nothing. The neighbouring pass-through pin's comment carried the same stale characterisation and is corrected the same way; its assertion (that `parseFilterAST` leaves `{ tags: ['a','b'] }` untouched) is unchanged and still pins the door not judging.
