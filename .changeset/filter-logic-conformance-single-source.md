---
"@objectstack/spec": minor
---

feat(spec): one canonical conformance table for the filter logical combinators

`FilterCondition` is evaluated by four independent implementations, and nothing
held them to a shared standard:

| Backend | Where |
|---|---|
| SQL compiler | `driver-sql` `applyFilterCondition` |
| In-memory matcher | `driver-memory` `memory-matcher` |
| Record-at-a-time evaluator | `formula` `matchesFilterCondition` (RLS write-side `check`) |
| Read-scope SQL lowering | `service-analytics` `read-scope-sql` |

In #3774 the SQL compiler OR-ed the contents *within* a `$or` branch instead of
AND-ing them, so every `$or` filter matched more rows than it should. The other
three were correct — but that was luck, not enforcement, and the divergence was
invisible until someone ran a real query. The fix for #3774 left three
near-identical shape tables copied across packages and the fourth backend
unlocked entirely, which is the same drift setup one step later.

`@objectstack/spec/data` now exports the table itself:

- `FILTER_LOGIC_ROWS` — a 2x2 truth table over two columns (so a wrongly-OR-ed
  pair always shows up as extra ids rather than by luck of the data), plus the
  record-scope columns real read scopes are written against.
- `FILTER_LOGIC_CASES` — 17 cases, each a `FilterCondition` and the ids it must
  match: keys within a branch, multiple operators on one field, `$and`/`$or`/
  `$not` nesting in both key orders, and the scope shapes that occur in shipped
  metadata.

Each backend now has a thin test that feeds the rows through its own evaluator
and asserts the shared expectations. **Adding a case to the table adds it to all
four at once** — that is the point.

Two things this bought immediately:

- `read-scope-sql` — the compiler that lowers RLS read scopes for the analytics
  path — is now verified by **executing** its SQL against a real engine and
  comparing rows. It was previously only checked by asserting the emitted SQL
  string, whose ceiling is the author's own reading of SQL. It passes unchanged.
- The table is a public export, so a third-party driver author can check a new
  backend against the same standard.

**Deliberate scope:** logical combinators only. The predicates are boring on
purpose — string equality, `$in`, `$ne`, `$gte`/`$lt`. Nothing here exercises
null handling, dates, numeric coercion, `LIKE` escaping or case sensitivity,
because those legitimately differ between a SQL engine and a JS matcher; folding
them in would make the table unpassable rather than more useful. A case belongs
in it only if **every** backend must agree.
