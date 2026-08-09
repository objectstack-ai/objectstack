---
"@objectstack/metadata-protocol": patch
---

fix(data): the dotted-path `400 INVALID_SORT` hint prescribes a **stored** field, not a formula (#6924)

`assertSortFieldsExist` refuses a dotted `orderBy` (`?sort=account.company_name`)
and then told the author how to fix it: *"Denormalise the value onto '<object>'
(a formula or rollup field that copies it into a real column) and sort by that."*
That prescription cannot be built. Following it lands the author back inside the
exact silent degradation the refusal had just saved them from.

Measured on a REAL `SqlDriver` (better-sqlite3) and on `InMemoryDriver`, with a
`formula` field named directly in `orderBy` (non-dotted, so this gate lets it
through):

```
control   orderBy title asc     -> A B C D E      a real column really sorts
baseline  no sort               -> C A E B D      insertion order
orderBy   <formula field> asc   -> C A E B D  200 insertion order
orderBy   <formula field> desc  -> C A E B D  200 direction-blind
```

A `formula` field is virtual — `SqlDriver.createColumn` returns early for it and
no column is created (sqlite answers `no such column`), the engine evaluates the
expression *after* the driver returns, and the #3821 unknown-column backstop
retries WITHOUT the sort. The response is `200`, every row present, order
arbitrary: the failure mode #4226/#4256 exist to stop.

The hint now reads: *"Denormalise the value onto '<object>' (a stored field,
written when the source changes) and sort by that. Not a formula field: it is
virtual, no driver materialises a column for one, and ORDER BY on it is silently
dropped."* — "stored" being the same word #6673 landed for the identical
correction on the search axis.

`rollup`/`summary` is dropped from the hint for a different reason, and the
measurement is worth recording because it contradicts the reported diagnosis: a
`summary` field **does** get a real, maintained column (`orderBy <summary> desc`
returned `E D C B A` over values `5 4 3 2 1`), so it is not unmaterializable. It
simply cannot do this job — a rollup aggregates CHILD records
(`count`/`sum`/`min`/`max`/`avg`) and so cannot carry a looked-up parent's column
onto the queried object.

**This overturns a recorded decision.** #4256 (closed `completed`) explicitly
chose the "formula or rollup" wording as its remedy for dotted-path sort, and its
own still-pending changeset (`sort-dotted-path-rejected.md`) describes it; that
file is left as the accurate record of what #4256 shipped, and this entry
supersedes its prescription. `content/docs/protocol/objectql/query-syntax.mdx`
("Sorting on Related Fields") taught the same denormalization and is corrected in
the same change, so code and docs stop agreeing with each other about something
untrue.

Not fixed here, filed separately: the platform still accepts a **non-dotted**
`orderBy` naming a `formula` field and answers `200` in arbitrary order. That is
an engine/driver-side refusal question, not hint text.
