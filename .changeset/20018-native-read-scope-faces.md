---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: the NativeSQL execute face and the `/analytics/sql` echo refuse a read scope the shared comparand faces refuse, as the ObjectQL execute face already does (#20018)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: `packages/spec` is untouched, and the shapes refused here are ones the spec's shared comparand faces (`assertListComparandShapes`, `normalizeFilterComparandTypes`) already refuse on every object-form `where` and, since #19995, on the ObjectQL analytics face. What changes is which runtime face refuses a read scope, so `objectstack migrate meta` has nothing to act on and the ledger has no row to gain. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a read-scope comparand shape (not `registered` / `already-registered`); and the change is runtime behaviour of a function, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING** — an accept-set narrowing on the read-scope lowering, shipped as
`minor` under the launch-window convention (`check-changeset-no-major` refuses
`major` until GA; breaking-ness is carried by this banner and the ADR-0087
disposition above, not by the level).

**What changed.** `compileScopedFilterToSql` is the read-scope lowering behind the
NativeSQL execute face (`NativeSQLStrategy.applyReadScope`, base table and every
joined hop) and the `/analytics/sql` echo (`ObjectQLStrategy.generateSql`), and a
public export of this package. Once its own lowering succeeds, it now runs the two
shared comparand faces of `@objectstack/spec/data` on the scope. A scope they
refuse is refused as `READ_SCOPE_COMPILE_FAILED` / 500 with the message withheld
(the #5367 envelope), before any statement is built or executed. That is the
answer the ObjectQL execute face has given the same scope since #19995, so one read
scope now gets one verdict on every analytics face.

**Which read scopes stop being served.** Each was lowered and executed before, and
each is refused by a standing ruling the shared faces carry. Measured on SQLite:

| read-scope shape | what the native face and the echo served |
| --- | --- |
| a `null` member of `$in` | only the named non-null values; the NULL matched nothing |
| a `null` member of `$in` under `$not`, or of `$nin` | only the rows whose column is NULL, which the scope excludes |
| a `null` comparand under `$gt` / `$gte` / `$lt` / `$lte`, or a `null` `$between` bound | zero rows |
| a blank (`''`) `$between` bound | the rows inside the half-blank range |
| a bigint beyond ±2^53, or a binary comparand | zero rows |
| a plain-object or other non-plain-object comparand in a scalar position | the database refused the statement (`DATABASE_ERROR` / 500) |

**Who is affected.** A host `getReadScope` provider, or a direct caller of
`compileScopedFilterToSql`, that produces one of these shapes. The ObjectQL
analytics face already refused all of them. No in-repo read-scope producer emits
them for a policy in this repository. An RLS `using` predicate can still be
written so that it lowers into the null shapes (a literal `null` inside an `in`
list, or an ordering comparison against `null`), and such a policy now gets the
withheld 500 on every analytics face.

**Fix.** State absence with the null predicate. "One of these values, or no
value" is `{ "$or": [{ "f": { "$in": ["a"] } }, { "f": { "$null": true } }] }`,
which in an RLS predicate is `f in ['a'] || f == null`. A one-sided range is `$gte`
or `$lte`. A comparand is a string, number, bigint within ±2^53, boolean, `null` or
`Date`.

**Unchanged.**

- Well-formed scopes compile to the same SQL and admit the same rows. That includes
  the null predicates, an emptied `$in` beside an own-rows grant, and the spelling
  above.
- A shape the lowering already refused keeps its own log sentence.
- The caller's own `where` never reaches this lowering, and it is untouched.
