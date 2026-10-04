---
'@objectstack/service-package': patch
'@objectstack/metadata-protocol': patch
---

fix: on MySQL, `sys_packages` is now created and written, so installed and edited packages survive a restart. When a `sys_packages` write fails, a package install or edit now answers the failure instead of success (#21243)

Clause-②: no

**`@objectstack/service-package`.** The `sys_packages` DDL and the publish upsert are spelled for the dialect the default driver names (`SqlDriver.dialectName`). SQLite and PostgreSQL keep the exact statements they always ran, and so does any driver that names no SQL dialect. MySQL gets the same `(id, version)` key and columns in its own spelling. Its index is created only after `information_schema` reports it absent, and its upsert is `INSERT … AS incoming ON DUPLICATE KEY UPDATE`, which needs MySQL 8.0.19 or later. Before this, the table was never created on MySQL. That DDL failed with `ER_INVALID_DEFAULT`, `ER_BLOB_KEY_WITHOUT_LENGTH` and `ER_PARSE_ERROR`. The DDL refusal was logged only at `debug`, as "may already exist". The `ON CONFLICT` upsert also failed with `ER_PARSE_ERROR`, so `POST /api/v1/packages/publish` answered `500 DATABASE_ERROR`. A refused DDL statement now fails the plugin's `start()` and is logged at `error`.

**`@objectstack/metadata-protocol`.** `installPackage` and `updatePackage` no longer answer success when the `package` service's `sys_packages` write fails. The registry write is undone first. A fresh install leaves no package and releases the namespace it registered. A re-install puts the prior row back, and an edit puts the prior manifest back. Then the failure is thrown. A store fault answers `500`, with `DATABASE_ERROR` from a live SQL driver and `INTERNAL_ERROR` otherwise. A declared 4xx refusal is passed through unchanged. Before this, `POST /api/v1/packages` answered `201` and `PATCH /api/v1/packages/:id` answered `200` over a write that never landed, and the package was gone after the next restart. A host with no `package` service still installs in memory only and says so with a warning. That degraded path is unchanged.
