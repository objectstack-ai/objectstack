---
"@objectstack/service-analytics": minor
---

**BREAKING**: on the ObjectQL path, a compiled dataset whose definition-level
`filter` is itself cross-object is now refused by both analytics doors instead
of reaching `engine.aggregate` with a predicate it cannot join (#10861).

PR #10758 gave the dataset's own definition-level `filter` a route onto this
door for the first time. That route was outside the member view the cross-object
envelope check judges, so nothing ever saw it:

```
dataset: object 'opportunity', include: ['account'],
         filter: { 'account.region': 'West' }

before   /analytics/query   200, rows   -> engine.aggregate received
                                           {"$and":[{"account.region":"West"}]}
         /analytics/sql     200, SQL
after    both               400 INVALID_FIELD, member "account.region",
                            cube "<dataset>"; the engine is never reached
```

`engine.aggregate` cannot join. `account.region` is not a column of
`opportunity`, so on any driver that evaluates the predicate honestly it matches
nothing, and the widget answered a number that was neither the scoped number nor
the unscoped one — with no error anywhere. That is the silent mis-bucket #3654's
loud refusal exists to prevent, arriving through a producer #3654 predates.

**Breaking, and argued rather than assumed.** A query that returns `200` with
rows today starts answering `400`, on a *saved* dataset rather than on anything
in the request — a dashboard that renders today can start showing an error. That
is the strongest reading of "breaking" and it is why this is called out here
rather than filed as a quiet fix. What is *not* lost is any correct answer: the
rows that stop being served were already wrong, and wrong in the way that hides
itself. The refusal names the member, names the dataset, and says the same
definition is valid on a native-SQL deployment, so the operator has somewhere to
go; the previous behaviour gave them a plausible number and nothing to notice.
Rejecting the dataset at compile time in `dataset-compiler.ts` was considered and
not taken (maintainer ruling, 2026-08-22): the compiler cannot see which driver
will serve the dataset, and the same definition is legal on a native-SQL one.

Who is affected: a deployment whose driver reports `objectqlAggregate` but not
`nativeSql` (Mongo, the memory driver), serving a dataset whose definition-level
`filter` names a field on a related object. Nothing an author writes changes
shape, no stored document is rewritten, and an **ordinary** dataset scope
(`filter: { is_deleted: false }`) still passes both doors and still reaches the
engine carrying its predicate — that direction is pinned one character away from
the new refusal in `crossobject-conjunct-refusal.test.ts`, because an
implementation that refused *every* dataset scope would look identical from the
refusal side alone and would break every scoped dataset shipping today.

<!-- adr-0087: not-required (no-migration-prescription) No authorable surface is
retired, renamed or re-shaped: `DatasetSchema`'s `filter` key stays exactly as it
is, every stored dataset document stays valid as written, and the very same
document remains correct on a native-SQL deployment. There is therefore nothing
`objectstack migrate meta` could rewrite — a mechanical rewrite would have to
know which driver will serve the dataset, which is precisely the capability the
2026-08-22 ruling records as invisible to the compile-time placement. This is a
query-time refusal on one driver family, not a surface retirement, so the ledger
has no entry to carry and the upgrade guide has no prescription to print. -->
