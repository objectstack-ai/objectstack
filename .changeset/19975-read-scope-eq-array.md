---
"@objectstack/service-analytics": patch
---

fix(service-analytics): the read-scope compiler refuses a list under `$eq` instead of binding it (#19975)

`compileScopedFilterToSql` compiles a row-level read scope into the SQL the analytics NativeSQL path and the `/analytics/sql` echo run. It already refused a list in the implicit equality slot (`{ field: [...] }`). The explicit spelling, `{ field: { $eq: [...] } }`, was compiled to an equality with the whole list bound as one parameter, so what the scope selected depended on how the executing database read a list. That could be an error, no rows, rows the scope never named, or every row under a negation.

It is now refused, at any depth under `$and` / `$or` / `$not`, with the envelope every other refusal of this compiler carries: `READ_SCOPE_COMPILE_FAILED` / 500, with the message kept for the server log. This applies ruling 乙 of #19757, which the shared comparand-shape face in `@objectstack/spec` already enforces, to a compiler that face never sees. `$ne` with a list is not part of that ruling and is not judged here.

No policy authored as metadata produces this shape: the CEL lowering emits `$eq` only around a `{ $field }` reference. The refusal therefore reaches only a host-supplied `getReadScope` or a direct caller of `compileScopedFilterToSql`. If you supply either, write "one of these values" as `{ field: { $in: [...] } }`. A scalar, `null` or a `Date` under `$eq` compiles exactly as before, and a `{ $field }` reference there keeps its existing answer.
