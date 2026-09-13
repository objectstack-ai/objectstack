---
"@objectstack/cli": patch
---

`os generate migration` gives the file family — `file` / `image` / `avatar` / `video` / `audio` — the **same column width in both formats**. The typescript format emitted a bare `table.string(name)`, knex's `varchar(255)`, while `--format sql` emitted `VARCHAR(2048)` for the same field, so one command answered one field with two widths depending on the flag (#17883).

2048 is not a new number: ADR-0104 ruled the generator's `VARCHAR(2048)` the end-state for this family, `driver-sql` moved to it (`MEDIA_ID_VARCHAR_CHARS`, #15989), and `os migrate files-to-references --apply` retypes the column to `varchar(2048)`. The typescript format was the one producer left at 255 — so a deployment scaffolded from it declared a width the migration it will later run retypes away from.

```diff
- table.string('cover_image').nullable();
+ table.string('cover_image', 2048).nullable();
```

- **No regeneration is required of anyone.** `syncSchema` / `initObjects` are additive and never alter an existing column's type, and a `sys_file` id is far shorter than 255, so nothing stored today is at risk either way. What moves is the **declared** width of tables generated from now on.
- **The width is now read from the sql format's own entry** instead of being retyped beside it, so the two formats cannot drift apart again; `generate-file-reference-width.pin.test.ts` measures both against `driver-sql`'s constant, which is what stops the two halves from "meeting in the middle" at some third value.
- ⛔ **Nothing outside the family moved.** The `text` family, the reference types the file family used to share an arm with (`lookup` / `master_detail` / `user` / `tree`), `autonumber`, and every `--format sql` answer are byte-identical.
