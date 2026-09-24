---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

fix(driver-sql, driver-turso): four filter-refusal doors stop naming a read scope's field and comparand unless the refused predicate is marked as the caller's own (#20020)

Clause-②: no

A read scope is the RLS, sharing or tenant predicate that `plugin-security` (ordinary reads) and `service-analytics` (the ObjectQL analytics face) AND into the caller's `where`. Both merges mark the scope `'policy'` and the caller's own predicate `'author'` (`markFilterSubtreeProvenance`, `@objectstack/spec/data`). When `SqlDriver` refused a scope at one of the four doors below, the `INVALID_FILTER` / 400 message named the scope's field, and for three of them its comparand too. It did not check the mark. Measured on both faces, through `POST /api/v1/analytics/query` and through an ObjectQL `find` under a merge shaped like `plugin-security`'s:

- a column the table does not have. This is reachable from a real CEL rule on a field that is declared but has no column yet;
- a retired operator (`$regex`, `$options`) or an operator outside the vocabulary;
- `$and` / `$or` whose operand is not a list;
- a `$null` / `$exists` whose comparand is not a boolean.

Each of these doors now reads the mark on the node it refused, the same way the cross-field and target-field refusals already did:

- **`'policy'`, unmarked or ambiguous:** same `INVALID_FILTER` / 400. The message says which kind of refusal fired and what the driver accepts, but names no field, operator, comparand or filter path. Those go to the server log. For the unresolvable column, the message is the unnamed wording the driver already used when it could not parse the dialect's message.
- **`'author'`:** the full message, the same text the door answered before.

To find the node, the unresolvable-column door looks up the column name the database reported. It discloses only when every node that names that column is marked `'author'`. A `$and` / `$or` with a primitive operand is judged by the node that carries the key.

**What an unmarked caller loses:** its own diagnostic from these four doors. Measured cases where the caller's own predicate reaches the driver unmarked:

- no security plugin in the stack;
- a system-context call;
- an anonymous call;
- a `where` that holds a `{placeholder}` token, which the engine rewrites before the merge.

That caller gets the withheld wording with the same code and status. A member's plain `where` under `plugin-security` is marked `'author'` and keeps the full text.

The same three door classes on the Turso REMOTE transport (`RemoteTransport`) now read the mark too: the retired or unknown operator (including a non-operator key in an operator map), the non-list combinator, and the non-boolean `$null` / `$exists`. The operands go to its diagnostic sink. `TursoDriver`'s remote mode rebuilds every filter node before the transport sees it, so no mark reaches the transport there, and these refusals keep the withheld wording for every caller in that mode. The unresolvable WHERE column has no refusal on the remote face (the transport answers `[]`) and is not changed here.

Not changed: which filters are refused, and the code and status of every refusal. The engine's declared-type, temporal-comparand and filter-token doors are not changed here.
