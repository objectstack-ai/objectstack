---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a currently-declared unique index is never legacy debt — index drift no longer ping-pongs (#3955)

An object may declare both a tenant-scoped field-level `unique: true` and an
object-level single-column unique index on the same column:

```ts
email: Field.email({ unique: true }),
indexes: [{ fields: ['email'], unique: true }],
```

The declared index materializes under `buildIndexName` as
`uniq_<table>_<column>` — which is also one of the two spellings
`legacyUniqueIndexNames` looks for when hunting pre-#3696 platform-wide
uniques. The detector therefore read an index the current metadata declares
as legacy debt and proposed replacing it with the tenant composite (which
the same sync had already created).

The resulting plan never converged: `apply` dropped the declared index, the
next `plan` reported it missing and recreated it, and the one after that
called it legacy again — an unbounded drop/create cycle on a live unique
index, every round rendered as a "safe" change.

`legacyUniqueReplacements` now takes the object's `declaredIndexes` and
filters their normalized names out of the legacy candidate set, so an index
metadata declares today is never mistaken for debt. Genuinely legacy indexes
are still retired, including the knex-spelled `<table>_<column>_unique` when
only the `uniq_…` spelling is declared.
