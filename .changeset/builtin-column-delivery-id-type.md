---
"@objectstack/driver-sql": patch
"@objectstack/platform-objects": patch
---

fix(driver-sql): the builtin-column delivery table speaks the spec's field-type vocabulary, not knex's builder names (#12131)

`BUILTIN_COLUMN_DELIVERY.id.type` recorded `'string'` — the **knex builder name** from
`table.string('id').primary()` — and `undeliveredStorageAttributes` compares that value
with `===` against a declaration's `type`, which is a spec `FieldType`. The two are
different vocabularies, and `'string'` is not a member of the one being compared: it is
absent from `FieldType`'s 49 options, `Field.string` is absent from the builder's keys,
and `FieldSchema` refuses `type: 'string'` outright. So **no declaration could ever
match it**, and the #12015 diagnostic reported every correct declaration on the
platform's own key as a disagreement.

Measured on a stock boot of `@objectstack/platform-objects`: **45 warnings, one per
system object**, each saying `type: 'text' (the column is 'string')` about a
declaration that was right all along. `varchar` canonicalizes to the field type `text`
(`canonicalizeSqlType('varchar(255)') === 'text'`, `suggestFieldTypeForSqlType('varchar(255)') === 'text'`,
`isCompatible('varchar(255)', 'text') === true` — all pinned in `type-compat.test.ts`),
so `id: Field.text(...)` asks for exactly what the platform's column delivers. The
delivery table now records `text`, and the 45 lines go silent because they were false,
not because they were suppressed.

`sys_migration.id`'s `maxLength: 128` was the one **honest** disagreement in that corpus
— the column is varchar(255) — and it is removed rather than widened to 255. It bound
nothing in any seam: the DDL discards a declared width on a builtin column name, and
`validateRecord` skips `id` by name on both the insert and the update path (it is also
`readonly`). Declaring a width that nothing enforces is the shape enforce-or-remove
exists to prevent, and the 44 sibling system objects declare none.

The classification pin now holds **every** entry in the delivery table to
`FieldType.options`, so a builder name written there fails by name instead of surfacing
as a corpus of false warnings. The fixtures in both #12015 pin files were written
against the delivery table rather than against the source — `sys_presence.id` was spelled
`type: 'string'` in the "silent" cases, which is why they passed while the same
declaration as actually written warned. They now use the shapes as declared, and the
firing cases declare a type that genuinely disagrees.

**Grade: `patch` for both, and deliberately.** No door moves and no DDL changes: the
platform still owns `id` / `created_at` / `updated_at`, the emitted column is
byte-identical, every object that booted before still boots, and `BUILTIN_COLUMN_DELIVERY`
is internal to the package (it is not re-exported from the package entry). The
`platform-objects` half removes one metadata key that was measured inert in every seam
that could read it. What changes is what the driver **says**.
