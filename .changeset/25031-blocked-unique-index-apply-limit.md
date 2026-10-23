---
'@objectstack/driver-sql': patch
'@objectstack/cli': patch
---

fix(driver-sql,cli): `os migrate plan` / `apply` no longer offer `--allow-destructive` for a unique index the existing rows already violate

Clause-②: yes (widening)
Metadata-protocol: none

The duplicate pre-flight that blocks such a `create_index` (ADR-0120 D4) said so only in the entry's message, and the apply-limit seam the two commands read asked the driver by op type. So `os migrate plan` closed with `(add --allow-destructive for drops / tightenings)`, `os migrate apply --yes` said `re-run with --allow-destructive to include them`, and that re-run refused the entry and ended PARTIAL.

- **`ManagedDriftEntry.applyLimit` (`@objectstack/driver-sql`, new and optional).** Why the reporting driver's apply door will not perform this entry on this database, read from its data. The duplicate pre-flight sets it on a blocked unique index, naming the conflicting groups. It is absent on every other entry, so a reader that ignores it sees the report as before. On `--json`, a blocked entry now carries this key.
- **`os migrate plan` / `os migrate apply` (`@objectstack/cli`).** The apply-limit seam reads the entry's own limit first, then the driver's per-op one. A blocked unique index is listed with the conflicting groups as the reason it cannot be applied, the footer and the skip lines stop offering `--allow-destructive` for it, and it is counted among the changes that remain drift. A database with no blocked index prints as before.

Unchanged: `os migrate apply --allow-destructive` still names such an entry as not applied and reports the run PARTIAL with exit 1, because the database still differs from its metadata. To clear it, deduplicate the listed rows and run `os migrate plan` again.
