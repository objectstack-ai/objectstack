---
'@objectstack/driver-sql': patch
---

`storage.notNull` now binds a multi-value column, as ADR-0113 says it does

`SqlDriver.createColumn` decides the JSON column shape before its per-type
switch, and it `return`ed there — above the ADR-0113 nullability line and above
the column DEFAULT. So `storage: { notNull: true }` on a multi-valued field was
silently inert on the platform's own table, while both `os generate migration`
formats emitted the constraint from the same declaration:

```
{ d_multi_notnull: { type: 'lookup', reference: 'sys_user', multiple: true, storage: { notNull: true } } }

field              driver              sqlgen              tsgen
d_multi_notnull    null=YES            null=NO             null=NO     ← before
d_multi_notnull    null=NO             null=NO             null=NO     ← after
```

One declaration, two databases: an INSERT omitting the field was accepted by the
platform's own table and refused by every table built from a generated
migration.

ADR-0113 P0 names this site verbatim — 「the physical constraint now keys off the
explicitly-authored `storage.notNull` at that same `#createColumn` site」 — and
carves out no field type. `storage.notNull`'s only declared exclusivity is
`requiredWhen`, at the parse seam, so `multiple: true` + `storage.notNull` is an
authorable declaration this site was dropping on the floor. The differ, the
ADR's other named consumer in this package, never had the gap: `fieldHasColumn`
answers the multi-value question first and the nullability comparison then runs,
so the platform reported DESTRUCTIVE `tighten_not_null` drift against tables it
had just created itself, with no rows in them. That self-inflicted report is
gone.

⚠️ Not the destructive ceremony ADR-0113 routes around. `createColumn` runs on
`CREATE TABLE` and on `ALTER TABLE ADD COLUMN`, so the column constrained here
is always EMPTY — the same reason the string family's #11431 note gives for
sizing a `varchar` at this site. Imposing `NOT NULL` over an EXISTING column's
possibly-null data stays `tighten_not_null`, destructive category, behind
`os migrate apply --allow-destructive`, untouched.

⛔ Not a widening, and nothing else acquired the constraint: `multiple: true`
alone still produces a nullable column, and `required: true` alone still does
too — it is the write-time contract the engine enforces, never the column
(ADR-0113). The column DEFAULT is still not emitted on this path either: the
multi-value shape has no scalar DDL form, and `os generate migration` skips it
for the same recorded reason, so the two producers already agreed there.
