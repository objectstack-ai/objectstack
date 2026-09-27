---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: the read-scope compiler refuses a list under `$eq` instead of binding it (#19975)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a compile-time refusal in the read-scope compiler: no authorable key, spelling or stored shape moves, and an authored policy never emits this spelling (the CEL lowering writes `$eq` only around a `{ $field }` reference), so a stored `sys_metadata` row needs no conversion. The remedy for a host-supplied read scope is to write the list under `$in`. -->

**BREAKING**: this narrows what `compileScopedFilterToSql`, exported from `@objectstack/service-analytics`, accepts. A read scope carrying `{ field: { $eq: [...] } }` compiled before this change and is refused after it. It ships as `minor` under the launch-window convention for accept-set narrowings. The remedy is `{ field: { $in: [...] } }` for "one of these values".

`compileScopedFilterToSql` compiles a row-level read scope into the SQL the analytics NativeSQL path and the `/analytics/sql` echo run. It already refused a list in the implicit equality slot (`{ field: [...] }`). The explicit spelling, `{ field: { $eq: [...] } }`, was compiled to an equality with the whole list bound as one parameter, so what the scope selected depended on how the executing database read a list, not on what the scope said.

It is now refused, at any depth under `$and` / `$or` / `$not`, with the envelope every other refusal of this compiler carries: `READ_SCOPE_COMPILE_FAILED` / 500, with the message kept for the server log. This applies ruling 乙 of #19757, which the shared comparand-shape face in `@objectstack/spec` already enforces, to a compiler that face never sees. `$ne` with a list is not part of that ruling and is not judged here.

No policy authored as metadata produces this shape. The refusal therefore reaches only a host-supplied `getReadScope` or a direct caller of `compileScopedFilterToSql`. A scalar, `null` or a `Date` under `$eq` compiles exactly as before, and a `{ $field }` reference there keeps its existing answer.
