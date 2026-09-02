---
"@objectstack/cli": patch
---

fix(cli): `os generate` stops naming field types that do not exist (#13871)

`packages/cli/src/commands/generate.ts` carried three hand-authored field-type
vocabularies — `FIELD_TYPE_MAP` (`os generate types`), `FIELD_TYPE_SQL_MAP`
(`os generate migration --format sql`) and the `switch (fType)` in the
typescript migration generator — and none of the three had ever been checked
against the `FieldType` enum it claims to describe. Between them they named six
types the platform has never had: `slug`, `ip_address`, `encrypted`, `integer`,
`uuid`, and `geo_point`.

They are not leftovers of retired types. `git log -S` over the whole reachable
history of `packages/spec/src/data/field.zod.ts` returns zero commits for every
one of those tokens — they were invented in the CLI and mirrored table to table
inside this one file.

Through every supported authoring path the arms were unreachable: `os init`
scaffolds `export default defineStack({ … })`, `define*` is a strict
`Schema.parse`, and a field typed `slug` is refused while the config module is
evaluated — before the generator runs a line. The one input class that could
reach them is a config that parses nothing (a plain-object default export, or
`defineStack(x, { strict: false })`), and for that class the generators were
emitting bespoke columns for types no runtime can serve. A vocabulary is a claim
about what the platform accepts, so the visible cost of keeping them was that
anyone — or any model — reading this file to learn the field types learned six
that do not exist.

Every ghost is removed rather than re-spelled. None of the six was a
misspelling of a real member with a fix to apply: `number` already had its own
entry and arm, so `integer` had nothing to correct to; `address` is a structured
postal address, not an IP; and the concepts that later arrived under other names
(`secret`, `location`) have no entry in these tables at all, which is a separate
coverage question rather than a spelling one.

Behaviour is unchanged for every config the platform accepts. For a config that
bypasses validation, a field typed with one of the six now falls to the same
default any unknown type gets — `table.text` / `TEXT` / `unknown` — instead of a
bespoke column.

`generate-field-type-vocabulary.pin.test.ts` now reads all three vocabularies
out of the source and fails on any key or case label that is not a `FieldType`
member, so the class cannot reopen. The pin is forward-only: real members with
no entry still fall through to the deliberate default, which it does not
prejudge.
