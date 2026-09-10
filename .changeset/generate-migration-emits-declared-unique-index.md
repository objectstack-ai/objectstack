---
"@objectstack/cli": patch
---

fix(cli): `os generate migration` emits the field-level unique index the driver creates (#16317)

## What was wrong

Both migration formats emitted the table and none of the object's declared
uniqueness. Measured on live PostgreSQL 16.13 — one object driven through all
three producers into three schemas, `pg_indexes` read back per schema:

```ts
{ name: 'probe', fields: { keyed_unique: { type: 'text', unique: true, maxLength: 100 } } }
```

| producer | before | after |
|:--|:--|:--|
| `driver-sql` via `initObjects` | `probe_pkey`, `uniq_probe_keyed_unique` | unchanged |
| `--format sql` | `probe_pkey` | `probe_pkey`, **`uniq_probe_keyed_unique`** |
| `--format ts` | `probe_pkey` | `probe_pkey`, **`uniq_probe_keyed_unique`** |

Two rows with the same `keyed_unique` value were refused by the platform's table
(`23505 ... violates unique constraint "uniq_probe_keyed_unique"`) and accepted
by both generated ones, with nothing reporting it: a scaffold that creates the
table for an object silently dropped a uniqueness guarantee the object declares.
After the change the duplicate is refused by all three, each naming the same
constraint.

The key set was not missing — it was already computed here to size the keyed
text family's columns; only the index it implies was never emitted.

## What it does now

- **`--format sql`** emits an inline `CONSTRAINT "<name>" UNIQUE (<columns>)`.
  That is what knex's `table.unique(columns, { indexName })` — the driver's own
  call — compiles to on PostgreSQL, so a generated table and a platform-created
  one agree in `pg_constraint` as well as in `pg_indexes`; and it stays inside
  the statement's `IF NOT EXISTS`, which a following `ALTER TABLE ... ADD
  CONSTRAINT` has no spelling for.
- **`--format ts`** emits that knex call itself, `indexName` included — which is
  what makes the driver recognise the constraint as already present on its first
  boot against a generated table, instead of adding a second one under its own
  name and then reporting the generated one as an orphan to drop.
- Names come from a transcription of `driver-sql`'s `buildIndexName`, pinned
  against the driver's own export (a CLI production module may not statically
  value-import a driver package).

## What it deliberately still does not emit — and now says so

Both formats print a `NOT EMITTED:` line naming the index, its key parts and the
reason, instead of dropping it silently:

- the **organization-scoped composite** (`unique: true` / `'organization'` on an
  object with an organization column), whose key part is
  `COALESCE(<organization column>, '__global__')`. Emitting the bare composite
  instead would be worse than emitting nothing: under SQL's NULL-distinct
  `UNIQUE` it constrains no row that has no organization, which on a
  single-tenant deployment is every row.
- an index over a column no field materialises (a virtual `formula` field) —
  the same skip the driver performs, where the driver logs a warning.

Object-level `indexes[]` remains unemitted by both formats; it is normalized by
a different driver-side rule and is not covered by this change.
