---
'@objectstack/service-package': patch
---

fix(service-package): after a restart the package registry serves the manifest written last, including a rollback re-install of an older version and several writes within one second (#33084)

Clause-②: no
Metadata-protocol: none

`sys_packages` keeps one row per `(id, version)`. The package service's "latest" reads (`get(id)`, `list()`, and through `list()` the boot's hydration, which is what a restart serves) picked the row with the greatest `created_at`. An overwrite keeps a row's `created_at`, and the stamp has whole-second precision, so a rollback re-install (1.0.0, then 2.0.0, then 1.0.0 again) was served live as 1.0.0 and as 2.0.0 after a restart, and three writes within one second came back as the first of them.

- The latest reads now pick by `updated_at`, which every write sets, insert or update.
- A publish binds `updated_at` as `YYYY-MM-DD HH:MM:SS.mmm` UTC. Within one process the stamp always moves forward: when the clock has not advanced since the previous write, it is one millisecond after that write's stamp. `created_at` keeps its `YYYY-MM-DD HH:MM:SS` form and its meaning (when the `(id, version)` row was first written), so the unmanaged-copy record that ties to it is unchanged.
- No migration. Rows written before this carry a whole-second `updated_at` that every earlier overwrite also refreshed, so a stored rollback written at least a second after the version it rolls back is picked correctly as it stands. A whole-second stamp sorts before every millisecond stamp of the same second. Stored rows that already tie on their second stay ambiguous, and so do writes from two processes whose clocks disagree: the forward step is per process. The table DDL and `idx_packages_latest` are unchanged.
- `PackageRecord.updated_at` is still a string; values written from now on carry milliseconds.
