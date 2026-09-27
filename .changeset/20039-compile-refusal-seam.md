---
'@objectstack/driver-sql': patch
'@objectstack/driver-sqlite-wasm': patch
'@objectstack/driver-turso': patch
---

fix(driver-sql, driver-turso): every filter-compile refusal stops naming a read scope's field or literal unless the refused predicate is marked as the caller's own (#20039)

Clause-②: no

A read scope is the RLS, sharing or tenant predicate that `plugin-security` (ordinary reads) and `service-analytics` (the ObjectQL analytics face) AND into the caller's `where`. Both merges mark the scope `'policy'` and the caller's own predicate `'author'` (`markFilterSubtreeProvenance`, `@objectstack/spec/data`). Nine more `SqlDriver` filter-compile refusals did not check the mark, so when one of them refused a scope, its `INVALID_FILTER` / 400 message named the scope's field, and for most of them its literal too. Measured through an ObjectQL `find` under a merge shaped like `plugin-security`'s, with the scope in the `'policy'` arm:

- an empty or non-string `$icontains` comparand;
- a non-string `$like` / `$ilike` comparand;
- a `$like` / `$ilike` pattern ending in a lone backslash;
- an object or array comparand on `$contains`, `$notContains`, `$startsWith`, `$endsWith` or `$icontains`;
- an `$in` / `$nin` / `$between` member that cannot be bound;
- an `undefined` comparand, in any position;
- an element of `$and` / `$or`, or the operand of `$not`, that is not a filter condition object;
- a `$`-prefixed key in a node position that is not `$and`, `$or` or `$not`;
- a `where` that reaches the driver as an array (the message printed the whole array).

Each of them now reads the mark on the node it was raised from, as the other compile refusals already did:

- **`'policy'`, unmarked or ambiguous:** same `INVALID_FILTER` / 400. The message says which kind of refusal fired, but names no field, operator variant, comparand, list position or filter path. Those go to the server log.
- **`'author'`:** the full message, the same text the refusal answered before.

With these nine, every refusal on `SqlDriver`'s filter-compile path goes through the same seam.

`SqliteWasmDriver` (`@objectstack/driver-sqlite-wasm`) and `TursoDriver` in local mode extend `SqlDriver`, so they inherit this change from it: the same refusals answer the same way there.

**What an unmarked caller loses:** its own diagnostic from these refusals. That is every caller whose predicate reaches the driver unmarked, for example with no security plugin in the stack, in a system-context or anonymous call, or with a `where` that holds a `{placeholder}` token (the engine rewrites it before the merge). That caller gets the withheld wording with the same code and status, and the full text is in the server log. A member's plain `where` under `plugin-security` is marked `'author'` and keeps the full text.

The Turso REMOTE transport (`RemoteTransport`) compiles filters itself. Its copies of these refusals now read the mark the same way: the `$icontains`, `$like` / `$ilike`, lone-backslash, `undefined`, non-node element or operand, undeclared-key and non-object `where` refusals. So do its two other compile refusals that still named the field: an operator map with no operator in it, and a `$between` that reached the transport without being lowered. The operands go to its diagnostic sink. For six of these classes, the withheld sentence is the local one behind the `[RemoteTransport]` prefix. An object text comparand and an unbindable list member already answered there through its comparand refusal, which withholds. `TursoDriver`'s remote mode rebuilds every filter node before the transport sees it, so no mark reaches the transport there, and these refusals keep the withheld wording for every caller in that mode.

Not changed: which filters are refused, and the code and status of every refusal.
