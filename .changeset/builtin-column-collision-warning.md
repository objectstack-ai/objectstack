---
"@objectstack/driver-sql": patch
---

fix(driver-sql): name the storage a declaration on a builtin column name loses, instead of discarding it in silence (#12015)

`initObjects` emits `id`, `created_at` and `updated_at` itself and then skips any
declared field colliding with one — `if (builtinColumns.has(name)) continue;`, with
no warning, no throw and no record anywhere that the author's declaration had been
dropped. Measured on live PostgreSQL 16.13: an object declaring
`id: { type: 'text' }` boots green and gets `id varchar(255)` — `table.string('id')`,
not TEXT. Measured here on SQLite: the same substitution, and a declared
`maxLength: 12` on that field binds nothing. The driver is right to own its primary
key and audit stamps; the defect was that it disagreed with the author in silence —
the declared-≠-enforced shape that bites hardest on AI-authored metadata, where the
mismatch surfaces much later as data behaving oddly.

Every DDL path that drops such a declaration now says so, naming the field, the
object, the attributes that were lost and what the platform's column actually is:

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

**Only the STORAGE half is reported, because only the storage half is lost.** A
declaration on a builtin column name still carries `label` (and the locales generated
from it), `readonly`, `searchable` and the ADR-0113 write contract in `required` — all
honoured on the platform's column exactly as on any other. So the diagnostic fires
only when the declaration asks for storage the platform's own column does not deliver
(a differing `type`, a `maxLength`, `unique`, `defaultValue`, `storage.notNull`, a
`multiple` shape…) and stays silent when it does not: `created_at: { type: 'datetime',
defaultValue: 'NOW()' }` describes precisely what lands, and says nothing.
`id: { type: 'number' }` — an author expecting a numeric key — still fires, as does
`id: { type: 'text' }`. The storage/presentation split is one table
(`builtin-column-collision.ts`) pinned against `FieldSchema.shape`, so a field key
added later is classified deliberately instead of defaulting into silence.

**Grade: `patch`, and deliberately.** Nothing about the accept set moves — every
object that booted before still boots, the DDL emitted is byte-identical, no public
type or metadata key changes, and the only observable difference is a line in the log
for storage that was already being discarded. The platform still owns `id` /
`created_at` / `updated_at`: this changes what the driver **says**, never what it
**does**.
