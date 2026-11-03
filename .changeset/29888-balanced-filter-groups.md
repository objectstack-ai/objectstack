---
'@objectstack/driver-sql': patch
---

fix(driver-sql): a `$or` / `$and` of many members compiles to a shallow expression tree, so comment and attachment reads stop failing on hosted libSQL

Clause-②: no
Metadata-protocol: none

The SQL compiler emitted every `$or` and `$and` group as one flat chain, `(a) or (b) or … or (n)`, which SQLite parses into an expression tree as deep as the group is long. A hosted libSQL server refuses a tree deeper than 100 ("Expression tree is too large (maximum depth 100)"). The comment-thread and attachment read gates OR one `ReadableIds` branch per registered parent object, so on a hosted environment with enough objects every `sys_comment` and `sys_attachment` read answered 500 `DATABASE_ERROR`, and record pages showed no comments and no attachments.

A group of more than eight members is now emitted as balanced parenthesised halves, so the depth it adds grows with the logarithm of its size: about eleven levels for 130 members instead of 130. The regrouping selects exactly the rows the flat chain did on every dialect, and a group of eight or fewer members compiles to the same SQL text as before. `driver-turso` and `driver-sqlite-wasm` inherit the change.
