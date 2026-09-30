---
'@objectstack/spec': minor
'@objectstack/driver-turso': minor
---

fix(spec,driver-turso)!: a turso config that forces `mode: 'local'` beside a `syncUrl` is refused where it is written and when the driver is built, instead of running as an embedded replica under a `local` label

Clause-②: yes (narrowing) — the accept set of the `turso` `datasource.config` contract narrows by one combination. No key is added, removed or renamed, and no exported symbol moves.

A `syncUrl` names the remote an embedded replica syncs with. A config that forced `mode: 'local'` on a `file:` url (or `:memory:`) beside a non-empty `syncUrl` was accepted by `@objectstack/spec`'s `TursoConfigSchema`, by the published mirror in `@objectstack/driver-turso`, and by `new TursoDriver()`. Measured on the driver source before this change, with a client that counts syncs: it constructed with `transportMode` `'local'`, then synced on connect, started the sync interval, and `isSyncEnabled()` answered `true` — exactly what the same config with no `mode` (a replica) did. A datasource declared local was kept in sync with a remote, and only a label said otherwise.

**BREAKING** accept-set narrowing on a published schema and a published constructor, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). Refused now, at both doors together, with one message whose prescription names both ways out:

- **at authoring**, as one `custom` issue on `mode` (`config.mode` on a datasource): `DatasourceSchema`, `validateDriverConfig`, `defineStack` / `os validate`, and a save or test connection through the datasource admin service;
- **at construction**, `VALIDATION_ERROR` / 400 from `new TursoDriver()` (and `createTursoDriver()`), before any client or database is opened.

The message is the same text at both doors, and a test holds the constructor's copy equal to the schema's issue byte for byte. It is the twin of the forced `mode: 'replica'`-without-`syncUrl` refusal, the other way round: honouring `mode: 'local'` by skipping the sync would ignore a declared `syncUrl` instead, which is the same defect with the keys swapped. The sibling refusals keep their order: a forced local mode on a remote url or a bare path still meets its `url` refusal first. An empty `syncUrl` is unset and is still accepted. The driver mirror declares no `mode` key and strips an authored one, so it cannot see a forced mode: this refusal reaches it only as byte-identical text, and the spec contract and the constructor are the two doors that judge it.

### Migration: FROM → TO

| You wrote | Write instead |
| --- | --- |
| `url: 'file:./data/replica.db', mode: 'local', syncUrl: 'libsql://my-db.turso.io'` | an embedded replica: drop `mode` (`url` and `syncUrl` select the replica) |
| the same | a plain local database: drop `syncUrl` (and `sync`), keeping `url: 'file:./data/app.db'` with or without `mode: 'local'` |

A datasource row stored in this shape is not re-parsed when it loads, so it now fails when the driver is built. `factory.create` throws the refusal. The connection service records the datasource as `failed-degraded` with the message, and a test connection answers `ok: false` ("Failed to build driver: …"). Under ADR-0062 D5, the boot fails fast when objects bind to that datasource or are routed to it, or when it is boot-critical, unless `OS_ALLOW_DRIVER_CONNECT_FAILURE` is set. Otherwise it is left unconnected with a warning. Before this change the same row booted and synced with the remote under a `local` label. The way out is the table above.

Blast radius, measured on this tree: no example, template, published skill or hand-written doc authors the shape, and no host default or environment variable sets `mode` or `syncUrl` (a turso `mode` reaches the driver only from an authored `datasource.config`). Whether any out-of-repo deployment declares such a config is NOT measured and is not claimed to be zero.

<!-- adr-0087: registered turso-config-forced-local-with-sync-url-refused -->
