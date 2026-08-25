---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a declared field colliding with a builtin column is named at load time instead of silently discarded (#12015)

`initObjects` emits `id`, `created_at` and `updated_at` itself and then skips any
declared field colliding with one — `if (builtinColumns.has(name)) continue;`, with
no warning, no throw and no record anywhere that the author's declaration was
dropped. Measured on live PostgreSQL 16.13: an object declaring
`id: { type: 'text' }` boots green and gets `id varchar(255)` — `table.string('id')`,
not TEXT. Measured here on SQLite: the same substitution, and a declared
`maxLength: 12` on that field binds nothing (`varchar(255)`). The driver is right to
own its primary key and audit stamps; the defect was that it disagreed with the
author in silence — the declared-≠-enforced shape that bites hardest on AI-authored
metadata, where the mismatch surfaces much later as data behaving oddly.

Every DDL path that drops such a declaration now says so, once per colliding field,
naming the field, the object and the platform's ownership:

- **create** — `while creating table "…"`, said before the CREATE runs, so the
  author hears it even when the CREATE goes on to fail for an unrelated reason;
- **ADD COLUMN diff** — `while syncing existing table "…"`; this path drops the
  declaration for a different reason (the builtin is already in the table, so the
  diff never proposes it), and it is the path a stock upgrade takes;
- **rotation shard** — `while syncing shard "…"`, covering both the shard-create and
  shard-column-sync branches.

A warning on one path with silence on the others just moves the trap, so each path
carries its own call and its own pin: a regression to a silent `continue` on one path
fails by name rather than being absorbed by a sibling.

**Grade: `patch`, and deliberately.** Nothing about the accept set moves — every
object that booted before still boots, the DDL emitted is byte-identical, no public
type or metadata key changes, and the only observable difference is a line in the
log for a declaration that was already being discarded. Maintainer ruling 2026-08-25
took exactly this and explicitly did **not** take "refuse boot" (a new rejection door
on an existing accept path, which needs an inventory of existing objects first) or
"make the declaration meaningful" (capability expansion with no pull — the platform
owning its primary key is correct design; the defect was only the silence).
