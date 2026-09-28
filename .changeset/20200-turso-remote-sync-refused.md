---
'@objectstack/driver-turso': minor
'@objectstack/spec': patch
---

fix(driver-turso)!: `new TursoDriver` refuses `syncUrl` under a forced `mode: 'remote'`, and `sync` with no `syncUrl`, instead of building and ignoring them

Clause-②: no (narrowing) — nothing is widened. No key is added, removed or renamed, and no exported symbol moves. Two driver configurations that the turso driver used to build and then ignore a key of are now refused when it is built.

`new TursoDriver()` accepted `syncUrl` beside a forced `mode: 'remote'`. Remote mode sends every read and write straight to `url`, and the remote client is created without `syncUrl`, so no replica is built and no sync ever runs. Measured on the built driver before this change, a `libsql://` or `file:` url under `mode: 'remote'` with `syncUrl` and `sync` constructed and connected, and `isSyncEnabled()` answered `true`. No sync interval started, and the sync call rejected with `SYNC_NOT_SUPPORTED` (`SyncNotSupported("File")` on the `file:` url). It also accepted `sync` with no `syncUrl`, in any mode, where nothing reads it. `@objectstack/spec`'s `TursoConfigSchema` already refused both at authoring. A datasource row stored before that, or a config a host builds itself, reached the constructor unparsed and ran with a sync setting that did nothing.

**BREAKING** accept-set narrowing on a published constructor, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). Refused now with `VALIDATION_ERROR` / 400, before any client or database is opened:

- `syncUrl` under a forced `mode: 'remote'`. A remote url beside `syncUrl` with no `mode` was already refused, as a replica on a remote url;
- `sync` with no `syncUrl` (or with an empty one), in local, replica and remote mode alike.

Each refusal's message is the spec contract's issue message for that key, byte for byte, so authoring and boot say the same thing. A test holds the copies equal. The spec's `syncUrl` message said the driver "runs no sync, so the setting changes nothing". It now reads "the turso driver refuses this configuration when it starts", like its sibling refusals, and the driver's own `TursoConfigSchema` mirror follows (`@objectstack/spec` patch: message text only). The ADR-0087 entry `turso-config-transport-mismatch-refused` now also records that the constructor refuses these two shapes at boot.

Left accepted on purpose: `mode: 'replica'` on a `file:` url with no `syncUrl` (and no `sync`). It still runs as a plain local database. Refusing it in the constructor alone would refuse a config both schemas accept, so it is tracked separately.

### Migration: FROM → TO

| You wrote | Write instead |
| --- | --- |
| `url: 'libsql://my-db.turso.io', mode: 'remote', syncUrl: …` (with or without `sync`) | a remote database: drop `syncUrl` and `sync`. An embedded replica: `url: 'file:./data/replica.db', syncUrl: 'libsql://my-db.turso.io'` and no `mode` |
| `url: 'file:./data/app.db', mode: 'remote', syncUrl: …` | the same two ways out |
| `sync: { … }` with no `syncUrl` | name the remote in `syncUrl` (with a `file:` url), or drop `sync` |

A datasource row stored with one of these shapes is not re-parsed when it loads, so it now fails when the driver is built. `factory.create` throws the refusal. The connection service records the datasource as `failed-degraded` with the message, and a test connection answers `ok: false` ("Failed to build driver: …"). Under ADR-0062 D5, the boot fails fast when objects bind to that datasource or are routed to it, or when it is boot-critical, unless `OS_ALLOW_DRIVER_CONNECT_FAILURE` is set. Otherwise it is left unconnected with a warning. Before this change the same row booted, reported sync as enabled and never synced. The way out is the table above: drop `syncUrl` / `sync` from a remote config, or use a `file:` url with the remote in `syncUrl`.

Blast radius, measured on this tree: no example, template, published skill or hand-written doc authors either shape, and no in-repo caller reads `isSyncEnabled()` or calls the driver's sync outside `@objectstack/driver-turso`'s own tests. Whether any out-of-repo deployment declares such a config is NOT measured and is not claimed to be zero.

<!-- adr-0087: not-required (already-registered turso-config-transport-mismatch-refused) that entry is this family's semantic TODO (the turso transport refusals, registered with the authoring half), and this diff updates its stored-row sentence to cover the constructor half: syncUrl under a forced remote mode and sync with no syncUrl are refused at boot as well -->
