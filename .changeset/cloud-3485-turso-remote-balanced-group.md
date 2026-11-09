---
'@objectstack/driver-turso': patch
'@objectstack/driver-sql': patch
---

fix(driver-turso): the remote face joins a large `$and` / `$or` as balanced halves, so comment and attachment reads fit a hosted libSQL server's depth limit

Clause-②: no
Metadata-protocol: none

On a remote Turso / libSQL database (`TursoDriver` with a `libsql://`, `https://` or `wss://` url and no `syncUrl`, as every hosted environment runs), every read of `sys_comment` and `sys_attachment` answered `500 DATABASE_ERROR` once the deployment registered roughly a hundred objects, as an installed app does. The driver's log named the cause: `Expression tree is too large (maximum depth 100)`. The comment and attachment read gates OR one `ReadableIds` branch per registered parent object, and the remote face's compiler joined a group's members into one flat chain, one expression level per member, while the hosted server refuses a tree deeper than 100.

The local face (`SqlDriver`) has emitted such groups as balanced halves since #29888. The remote face compiles its SQL text itself, so that change never reached it. It now regroups by the same rule, shared from `@objectstack/driver-sql` as `joinBalancedGroup` (with `FLAT_GROUP_MAX_MEMBERS`): a group of at most 8 members compiles byte-identical to before, and a larger one as two parenthesised halves, recursively, so the depth it adds grows with the logarithm of its size. Measured on the gate's own shape with 134 branches and a three-level master chain: 162 levels before, 38 after.

The regrouped expression selects exactly the rows the flat one did, on every dialect: `AND` and `OR` are associative over SQL's three-valued logic, the members keep their order, and so do their bind values. No gate, scope or tenant wall changes.
