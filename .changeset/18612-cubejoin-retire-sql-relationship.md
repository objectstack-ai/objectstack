---
'@objectstack/spec': minor
---

**BREAKING** — retire `CubeJoin.sql` and `CubeJoin.relationship`. A cube join declares
WHICH object it reaches; the ON clause is derived from the declared relationship between
the two cubes' objects and is never authored.

`CubeJoin.sql` was **required** and described itself as the `ON` clause, and nothing ever
read it. Both analytics strategies synthesise the join: `NativeSQLStrategy` emits
`LEFT JOIN <name> <alias> ON "<parent>"."<segment>" = "<alias>"."id"` from the dotted member
path alone, and `ObjectQLStrategy` resolves the join through `cube.joins?.[alias]?.name` and
lowers it to a relationship traversal with no `ON` clause at all. So an authored join
condition was not ignored — it was **replaced**, under a `200`, by an equality the author had
not asked for, with a plausible number attached. `relationship` is the same shape one key
over: it carried a `.default('many_to_one')`, nothing dispatched on the cardinality, and
`one_to_many` parsed, changed no SQL and kept the many-to-one arithmetic.

ADR-0049 enforce-or-remove; maintainer ruling 2026-09-18 (director batch #154 item 4,
letter 2). The ruling declined the other remedy — executing the author's SQL — as a new
capability whose first design question is an injection boundary, for zero authors today. A
custom join condition, if a customer needs one, is a capability card with that boundary
decided first.

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `joins: { account: { name: 'crm_account', relationship: 'many_to_one', sql: '${orders}.account = ${crm_account}.id' } }` | `joins: { account: { name: 'crm_account' } }` — delete both keys |
| `joins: { a: { name: 'b', relationship: 'one_to_many' } }` | `joins: { a: { name: 'b' } }` — the cardinality was never read; declare it on the object's own relationship field |
| `joins: { a: { name: 'b', on: '…' } }` | `joins: { a: { name: 'b' } }` — `on` was the curated alias for `sql` and is retired with it |

**The one-line fix:** delete `sql` and `relationship` from every `joins` entry; keep `name`.

Nothing regresses by deleting them: neither key ever reached a query. What decides the join
is `name` (the joined object, which is also what the per-object RLS/tenant read scope is
computed for) and the declared relationship the runtime derives the equality from.

## The retirement kit

- **Strict deletion plus a `guidance` prescription, not a `retiredKey()` tombstone.** Every
  cube shape is a `strictObject`, so the key leaves the walked shape entirely and the
  refusal carries the upgrade: writing `sql`, `relationship` or `on` on a join is an
  `unrecognized_keys` rejection whose message names the key and states that the `ON` clause
  is DERIVED from the declared relationship between the two cubes' objects. Same route
  `MetricSchema.filters` took one shape over in this same file.
- **`on` is no longer an alias.** It pointed at `sql`; an alias naming a key the shape
  cannot accept answers an author with a second rejection, so it became a `guidance` entry
  of its own and the rename suggestion is gone. Pinned in both directions.
- **ADR-0087: a D3 SEMANTIC entry**, `cube-join-sql-and-relationship-retired`, plus the two
  exact-key registrations `data/CubeJoin:sql` and `data/CubeJoin:relationship` in
  `RETIRED_KEYS_BY_MAJOR[18]`. Not a D2 conversion: the ruling's census found zero authored
  cube joins outside this repository, so there is no consumer source to rewrite, and a
  mechanical strip would delete the key without recording which cube lost it — an author who
  wrote a non-FK `sql` wanted a join the runtime does not perform, and that want needs a
  decision rather than a rewrite. The `list-view-navigation-view-retired` entry took the same
  route for the same reason.
- **No `os migrate meta` sentence** in either prescription: that sentence is owed only where
  an ADR-0087 conversion covers the surface, and none does.
- **The liveness ledger rows went WITH the keys** (`liveness/analytics_cube.json`), which is
  the strict-deletion route's disposition — the opposite of the tombstone route, which keeps
  the row because `retiredKey()` keeps the key in the walked shape. `analytics_cube` drops
  from 12 `dead` to 10.
- **The one in-repo producer is fixed in the same diff.** `examples/app-showcase`'s
  `DeliveryCube` authored both keys, including an `ON` clause the runtime was replacing;
  `dataset-compiler.ts` minted them as two constants no reader consulted.

Clause-②: yes (narrowing)

<!-- adr-0087: registered cube-join-sql-and-relationship-retired -->
