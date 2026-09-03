---
"@objectstack/cli": patch
---

fix(cli): `os generate` now has an answer for every field type, instead of silently guessing

Three hand-kept vocabularies in `generate.ts` decide what `os generate types`
and `os generate migration` emit for a field: the TypeScript type, the SQL
column type, and the knex builder call. None of them was ever checked against
the `FieldType` enum they describe, and measured against the 49 members on
`main`, **21 real members had no entry in either lookup table and 24 had no arm
in the migration switch**.

An unmapped member did not fail — it fell to the default. So a `secret` field
scaffolded as TypeScript `unknown` and a `TEXT` column, a `location` as
`unknown` and `TEXT`, and `address` / `composite` / `repeater` / `record` — all
four stored as JSON on the parent row — as scalar `TEXT` columns. The output
looked plausible and nothing said otherwise, which is what made this worth
fixing rather than tidying.

All 49 members now have an entry in all three, and the values are read off the
platform rather than invented: the spec's ADR-0104 D1 value classes
(`STRING_VALUE_TYPES`, `NUMERIC_VALUE_TYPES`, `STRUCTURED_JSON_TYPES`, …) decide
the class, and `driver-sql`'s own DDL emitter — which creates the real columns —
decides the shape. `location` becomes a JSON column, not a `POINT`: that is what
the driver does, `POINT` is not portable to SQLite, and the spec's own value
contract for it is `{lat, lng, altitude?, accuracy?}`. `location` and `address`
now emit the spec's exported `Data.LocationValue` / `Data.AddressValue` types,
so the generated interface cannot drift from the value contract.

The gap can no longer reopen quietly. Both lookup tables are
`satisfies Record<FieldType, string>`, so a field type added to the spec is a
named compile error here; the switch — whose scrutinee is a plain string off an
unvalidated config and so cannot carry one — is held by
`generate-field-type-vocabulary.pin.test.ts`, which walks the real enum and
names any member left unmapped.

The runtime fallbacks (`|| 'unknown'`, `|| 'TEXT'`, `default:`) are unchanged
and still reachable: they answer a `type` string that is not a field type at
all, which the unvalidated authoring door can still deliver.
