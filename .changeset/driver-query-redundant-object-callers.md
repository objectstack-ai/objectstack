---
"@objectstack/metadata": patch
"@objectstack/objectql": patch
---

fix(metadata,objectql): stop restating the object name inside driver queries — and stop casting away the query's type to do it (#6231)

`DriverQuery` (`Omit<QueryAST, 'object'>`) landed in #6076 and five drivers
followed in #6075, but five **call sites** stayed as they were, because they
were hidden behind a cast where the compiler could not see them. This removes
the redundant key at all five and, with it, the casts that existed only to
carry it.

The redundant key was never the expensive half. `git grep 'query\.object' --
'packages/drivers/*/src'` is zero: no driver reads it, so the key itself was
inert. **The cast was the cost.** `as any` on a query argument does not
suppress one key — it switches off checking for `where`, `orderBy` and
`fields` as well, which is precisely the account #5181's changeset opened
(cloud#1053 measured 20 such sites; cloud#1030's `$like` — an operator the
filter dialect does not have — survived compilation and reached the runtime
through exactly this hole). `packages/metadata`'s `DatabaseLoader` is the
main metadata read path, so it was the worst place to be running unchecked.

The five sites:

- `metadata` `DatabaseLoader._find` / `._findOne` / `._count` — each was
  `driver.find(table, { object: table, ...query } as any)`. The helpers now
  declare `query: DriverQuery` and hand it to the driver unchanged and uncast,
  so all nine of their call sites' `where` / `orderBy` / `fields` are checked
  again.
- `objectql` `ObjectQL.resolveSecret` — the `sys_secret` read was
  `{ object: 'sys_secret', where: { id } } as QueryAST`, where the cast existed
  only to satisfy the AST's then-required `object`. Both are gone.
- `objectql` `LifecycleService` governance counter — `count(obj.name,
  { object: obj.name })` carried no cast; it was admitted by a hand-written
  driver shape whose `query` was `Record<string, unknown>`, which would equally
  have admitted a `where` the dialect does not have. That shape is now the named
  `CountCapableDriver` typed with `DriverQuery`, and the call passes argument
  one only.

No behaviour changes: the key was inert on every path, and the object name has
always travelled as the driver methods' first argument. What changes is that
these call sites are type-checked again, and that re-adding the key is now a
compile error (`TS2353`) rather than something a cast quietly absorbs.
