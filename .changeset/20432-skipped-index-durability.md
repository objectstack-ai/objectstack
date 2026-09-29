---
'@objectstack/driver-sql': minor
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@objectstack/lint': patch
---

fix(driver-sql): a declared index that can never be built is logged at `error` and reported in drift

**Clause-②: yes (widening)**: the exported `DriftOp` union gains one member, `unbuildable_index`.
No accept set changes. Nothing an author could write before is refused now.

A declared index names a column that no declaration will ever create when:

- the name is not a field of the object, for example a misspelling that the Studio save door
  admits (`os validate` / `os build` already refuse it); or
- the name is a virtual `formula` field, which is computed on read and has no column. The same
  applies to a field-level `unique` on a formula field.

The SQL driver skips such an index at every sync. It used to say so at `warn`, and the drift
report dropped the index from the expected set, so `os migrate plan` showed nothing. For a
`unique` index, the declared constraint was not enforced and duplicate rows were accepted,
while everything looked normal.

- **The sync logs the skip at `error`**, on the same durability channel as the duplicate-row
  refusals in the same loop. One line per skipped index per sync names the object, the index,
  each missing column with its reason (not a field of the object, or a formula field), and
  whether the index is `UNIQUE`. The structured meta carries `index`, `missing` and `unique`.
- **Drift reports it** as a report-only entry: `kind: 'index_mismatch'`, `actual: '(absent)'`,
  `category: 'needs_confirm'`, `severity: 'error'` for a unique index and `'warning'` otherwise.
  Its op is the new member:

  ```ts
  { type: 'unbuildable_index'; table: string; column?: string; indexName: string;
    unique: boolean; missingColumns: string[] }
  ```

  `missingColumns` lists only the columns that will never materialize. A declared column that
  is merely not added yet is pending additive work, not this finding.

**What a consumer that reads `op.type` now sees.** A new value, `'unbuildable_index'`. It has
no reconciler arm, and none can exist, because there is no column to build over. The remedy is
a metadata edit. It is in `INDEX_DRIFT_OPS`, so `isIndexDriftOp` answers `true` and it never
triggers a SQLite table rebuild. `applyMigrationEntries` reports it `skipped` on every dialect.
`os migrate plan` lists it under "Needs confirmation", addressed by its index name. `os migrate
apply` counts it like any `needs_confirm` entry (so it asks for `--yes`), and then reports it
skipped. The artifact-pinned boot warns about it and still starts, because
only `destructive` entries refuse a boot. A `switch` over `op.type` that treats unknown values
as "not applied" needs no change. An exhaustive `switch` with a `never` check gets one more case
to handle.

**The object form's help text follows.** The `indexes` → Fields help in the Studio object form
said the skip left "a warning in the server log". It now says an error, in English and in the
zh-CN, ja-JP and es-ES translations. Nothing else in the text changes.

**The lint message follows too.** `object-field-ref-unknown`, on a misspelt `indexes[].fields`
name, said the SQL driver skips the index "with only a warning, and drift drops it too". It now
says the skip is logged at error and `os migrate plan` reports the index as unbuildable. The rule,
its severity and its prescription are unchanged.

**Upgrade note:** on a database that already carries such an index, `os migrate plan` now
reports one entry per index, and so does the boot's drift warning. That entry clears only when
the metadata names stored fields or drops the index.
