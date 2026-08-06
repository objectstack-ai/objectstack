---
"@objectstack/spec": major
"@objectstack/metadata-core": patch
---

refactor(spec)!: retire `indexes[].type` and `indexes[].partial` — two authorable index keys no driver ever read (#5248, #4943)

`IndexSchema` declared five keys; only three of them ever reached a `CREATE
INDEX`. `SqlDriver.syncDeclaredIndexes` builds every declared index through
knex's `table.index(fields, name)` / `table.unique(fields, { indexName })`, and
the drift differ's `DeclaredIndexInput` carries `name` / `fields` / `unique` /
`nullSafeColumns`. So:

- **`partial`** — documented as *"Partial index condition (SQL WHERE clause)"* —
  produced a **full** index with the predicate silently discarded. This was the
  damaging half, because it reads as a correctness control: the platform's own
  `sys_metadata` declared `partial: "state = 'active'"` for overlay uniqueness,
  and what the declaration alone materialized was an *unrestricted* unique index.
- **`type`** additionally carried `.default('btree')`, so it appeared in **every**
  parse output of **every** index — an access-method knob that had never
  influenced a single statement, rendered as live configuration. (It was pinned
  as such in a `sys_presence` test, on an object that never declared it.)

Both are the ADR-0078 no-silently-inert / ADR-0049 enforce-or-remove shape.
Remove was chosen over enforce: enforcing needs per-dialect algorithm mapping
(`gin`/`gist` Postgres-only, `fulltext` MySQL-family), raw-SQL `CREATE INDEX …
WHERE` on the dialects that have partial indexes at all (MySQL does not), and a
redesign of how `isSyncReproducibleIndex` excludes partial indexes from
incremental sync — design cost for a capability with no demand. If a real need
appears it returns enforce-first.

## Migration

| FROM | TO |
| :--- | :--- |
| `indexes: [{ fields: […], type: 'gin' }]` | `indexes: [{ fields: […] }]` — create the specialised index from a database-layer migration |
| `indexes: [{ fields: […], partial: "state = 'active'" }]` | `indexes: [{ fields: […] }]` — issue `CREATE [UNIQUE] INDEX … WHERE …` from a runtime migration |

**One-line fix: delete the key.** Neither removal changes any DDL, because no
DDL ever depended on them — verified byte-for-byte against the `CREATE INDEX`
statements SQLite actually stores
(`packages/drivers/driver-sql/src/declared-index-retired-keys.test.ts`).

Both capabilities remain available where they are implementable. The index
method is the driver/dialect's choice. A partial index is issued as raw SQL from
a runtime migration — exactly what `metadata-protocol`'s `ensureOverlayIndex`
already does for `sys_metadata`, and what actually delivers that table's
active-row-scoped uniqueness today.

⚠️ **Not affected:** driver-sql's own `partial` flag (`parseIndexDdl` /
`introspectIndexes` / `isSyncReproducibleIndex`). That is a boolean parsed back
out of the *database's own* DDL for drift detection — the opposite direction —
so migration-created partial indexes stay recognized and exempt from incremental
sync, unchanged.

## The retirement kit

- `retiredKey()` tombstones at `IndexSchema` (the shape is deliberately
  `.strip()`, so a plain delete would swap one silent no-op for another): writing
  either key is now a `tsc` error and a parse error carrying the prescription.
  They sit at the bottom of the shape per the #5606 renderer note.
- **ADR-0087 D2 conversion + D3 chain step** (`object-index-type-partial-removed`,
  `toMajor: 17`, wired into the existing step-17 chain): strips both keys from
  `objects[]` and `objectExtensions[]`; `os migrate meta --from 16` rewrites sources
  mechanically. A pure lossless delete — there was no effect to lose.
- **Producers flipped:** `sys_metadata` (`idx_sys_metadata_overlay_active`, the
  case #4943 named) and `sys_view_definition` (`idx_sys_view_def_active`), both
  with their comments corrected to say what is actually materialized.
- Published skill (`objectstack-data`), `content/docs/data-modeling/objects.mdx`,
  liveness ledger note and generated baselines updated.
