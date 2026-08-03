---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a fresh database no longer boots "drifted", and the drift
detector never points `--allow-destructive` at an index the framework created
(#4884)

Booting `examples/app-showcase` on a brand-new empty SQLite file printed two
`[schema-drift]` warnings before the server was even ready, both about the
ADR-0048 overlay indexes the same boot had just created. Both were false, and
one of them was dangerous:

> `[schema-drift] sys_metadata: index 'idx_sys_metadata_overlay_draft' UNIQUE
> (type, name, organization_id) carries ObjectStack's generated naming but
> matches no declared index (orphaned) — "os migrate apply --allow-destructive"
> to drop it.`

`idx_sys_metadata_overlay_draft` is the unique index enforcing **draft-overlay
uniqueness**. An operator following our own boot advice would have dropped a
live data-integrity guarantee to fix a problem that did not exist — and, worse,
learned to treat `--allow-destructive` as routine boot hygiene, which is exactly
what makes the *next*, real drift warning dangerous.

Three fixes, in the driver's detector only (no metadata declaration changed —
`sys-metadata.object.ts` documents its four-column `indexes[]` entry as *the
fallback shape for drivers without the runtime migration*, and that contract
still holds for the drivers that rely on it):

- **The index key is now read as written.** Introspection took the key from each
  dialect's per-column catalogue view (`PRAGMA index_info`, `pg_attribute`,
  `STATISTICS.COLUMN_NAME`), which describes an expression key as a NULL column
  and nothing else. The canonical
  `(type, name, organization_id, COALESCE(package_id,''))` overlay index
  therefore arrived as three columns and was reported as a mismatch against its
  own four-column declaration. SQLite and Postgres now parse the index
  definition (`sqlite_master.sql` / `pg_get_indexdef`), MySQL reads
  `STATISTICS.EXPRESSION` where the server has it, and `COALESCE(col, <literal>)`
  is recognised as keying on `col` — which is what ADR-0048 uses it for: a plain
  UNIQUE index treats NULLs as distinct, so package-less globals would not be
  unique among themselves.
- **Partial predicates are captured.** A `WHERE`-restricted index is something
  `syncDeclaredIndexes` can neither create nor rebuild, so the detector no
  longer claims authorship of one, no longer calls it orphaned, and never
  proposes a remedy it could not undo.
- **The driver keeps a ledger of the index DDL it executed.** An index this
  process created through raw `execute()` — how `metadata-protocol`'s
  `ensureOverlayIndex` issues its migration — is the framework's to manage. This
  also covers the plain-index fallback the same migration takes on dialects that
  reject partial indexes.

Genuine drift is unaffected: an orphaned generated index, a redefined declared
index and the #3696 legacy-unique replacement are all still detected, still
categorised exactly as before, and still remediable through `os migrate`.
