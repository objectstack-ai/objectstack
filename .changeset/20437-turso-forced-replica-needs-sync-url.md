---
'@objectstack/spec': minor
'@objectstack/driver-turso': minor
---

fix(spec,driver-turso)!: a turso config that forces `mode: 'replica'` with no `syncUrl` is refused where it is written and when the driver is built, instead of running as a plain local database that never syncs

Clause-②: yes (narrowing) — the accept set of the `turso` `datasource.config` contract narrows by one combination. No key is added, removed or renamed, and no exported symbol moves.

An embedded replica is a local file kept in sync with the remote named in `syncUrl`. A config that forced `mode: 'replica'` on a `file:` url with no `syncUrl` (or an empty one) was accepted by `@objectstack/spec`'s `TursoConfigSchema`, by the published mirror in `@objectstack/driver-turso`, and by `new TursoDriver()`. Measured on the built driver before this change, with and without `sync`: it constructed with `transportMode` `'replica'`, `isSyncEnabled()` answered `false`, no sync interval started, the sync call did nothing, and every read and write went to the local file. A datasource declared as a replica ran as a plain local database that never replicated, with no error and no warning.

**BREAKING** accept-set narrowing on a published schema and a published constructor, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). Refused now, at both doors together, with one message whose prescription names both ways out:

- **at authoring**, as one `custom` issue on `mode` (`config.mode` on a datasource): `DatasourceSchema`, `validateDriverConfig`, `defineStack` / `os validate`, and a save or test connection through the datasource admin service;
- **at construction**, `VALIDATION_ERROR` / 400 from `new TursoDriver()` (and `createTursoDriver()`), before any client or database is opened.

The message is the same text at both doors, and a test holds the constructor's copy equal to the schema's issue byte for byte. The sibling refusals keep their order. A forced replica on a remote url, an in-memory url or a bare path still meets its `url` refusal first. One with `sync` and no `syncUrl` still meets the `sync` refusal first; the schema now reports the `mode` issue beside it. The driver mirror declares no `mode` key and strips an authored one, so it cannot see a forced mode: this refusal reaches it only as byte-identical text, and the spec contract and the constructor are the two doors that judge it.

### Migration: FROM → TO

| You wrote | Write instead |
| --- | --- |
| `url: 'file:./data/replica.db', mode: 'replica'` (no `syncUrl`, or `syncUrl: ''`) | an embedded replica: keep the `file:` url and name the remote, `syncUrl: 'libsql://my-db.turso.io'` |
| the same | a plain local database: drop `mode` (`url: 'file:./data/app.db'` alone) |

A datasource row stored in this shape is not re-parsed when it loads, so it now fails when the driver is built. `factory.create` throws the refusal. The connection service records the datasource as `failed-degraded` with the message, and a test connection answers `ok: false` ("Failed to build driver: …"). Under ADR-0062 D5, the boot fails fast when objects bind to that datasource or are routed to it, or when it is boot-critical, unless `OS_ALLOW_DRIVER_CONNECT_FAILURE` is set. Otherwise it is left unconnected with a warning. Before this change the same row booted and ran as a local database. The way out is the table above.

Blast radius, measured on this tree: no example, template, published skill or hand-written doc authors the shape, and no host default or environment variable sets `mode` (a turso `mode` reaches the driver only from an authored `datasource.config`). Whether any out-of-repo deployment declares such a config is NOT measured and is not claimed to be zero.

<!-- adr-0087: registered turso-config-forced-replica-without-sync-url-refused -->
