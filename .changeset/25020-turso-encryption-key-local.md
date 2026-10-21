---
'@objectstack/spec': minor
'@objectstack/driver-turso': minor
'@objectstack/service-datasource': patch
---

fix(spec,driver-turso)!: a turso datasource that declares `encryptionKey` on a local file or an embedded replica is refused where it is written and when the driver is built, instead of being accepted and written in plaintext

Clause-②: no (narrowing) — the accept set of the `turso` `datasource.config` contract, of the published `TursoConfigSchema` mirror and of `new TursoDriver()` narrows by one key beside a `file:` url or `:memory:`, in every mode. No key is added, removed or renamed, and no exported symbol moves. `@objectstack/service-datasource` is graded `patch`: the TSDoc of its exported `TursoDriverConfigInput.encryptionKey` no longer promises an encrypted file, and nothing else in it changes.

`encryptionKey` was declared as an "AES-256 encryption key for the local database file", and nothing applied it. The turso driver reads and writes a local or replica file through better-sqlite3, which has no encryption codec (`PRAGMA key` is a silent no-op there). Measured on the driver source with a test key: a local datasource with `encryptionKey` constructed, connected and wrote its rows, and plain better-sqlite3, opening the file read-only with no key, read them back. An embedded replica fared no better: only its sync client was handed the key, after the local engine had already written the file in plaintext, and a file that client encrypted is one the local engine cannot open. An operator who declared the key got an unencrypted file and no signal.

**BREAKING** accept-set narrowing on a published schema and a published constructor, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). A non-empty `encryptionKey` on a local datasource (a `file:` url or `:memory:`) or an embedded replica (a `file:` url beside `syncUrl`), detected or forced with `mode`, is refused now, at both doors together, with one message per mode that names the mode and what does encrypt. The key is judged by where the database lives, not by the mode: the same `file:` url or `:memory:` under a forced `mode: 'remote'` is refused too, in its own words, because the driver hands that url to the libSQL client it builds, which is handed no key, so the file was written in plaintext all the same:

- **at authoring**, as one `custom` issue on `encryptionKey` (`config.encryptionKey` on a datasource): `DatasourceSchema`, `validateDriverConfig`, `defineStack` / `os validate`, and a save or test connection through the datasource admin service;
- **at construction**, `VALIDATION_ERROR` / 400 from `new TursoDriver()` (and `createTursoDriver()`), before any database file is opened.

The message is the same text at all three places, and a test holds the constructor's copy equal to the schema's issue byte for byte. It comes last among the local-engine refusals: a url the engine cannot open, a lone `sync` and a forced `mode` the driver would ignore each keep their own message. An empty `encryptionKey` is unset and is still accepted. A remote url (`libsql://`, `https://`, `ws(s)://`) is not judged by this refusal. The `encryptionKey` describe texts no longer promise an encrypted file.

### Migration: FROM → TO

| You wrote | Write instead |
| --- | --- |
| `url: 'file:./data/app.db', encryptionKey: '…'` | drop `encryptionKey`; put the file on an encrypted disk or volume if it must be encrypted at rest |
| `url: 'file:./data/replica.db', syncUrl: 'libsql://my-db.turso.io', encryptionKey: '…'` | drop `encryptionKey`, the same way |
| `url: 'file:./data/app.db', mode: 'remote', encryptionKey: '…'` (or `url: ':memory:'`) | drop `encryptionKey`, the same way |
| either, where the data must be encrypted at rest and no encrypted volume is available | a remote Turso database (`url: 'libsql://my-db.turso.io'`), whose storage encryption is the server's to configure, not this key's |

The fix in one line: delete `encryptionKey` from every turso datasource whose `url` is a `file:` url or `:memory:`.

A datasource row stored in this shape is not re-parsed when it loads, so it now fails when the driver is built. `factory.create` throws the refusal. The connection service records the datasource as `failed-degraded` with the message, and a test connection answers `ok: false` ("Failed to build driver: …"). Under ADR-0062 D5, the boot fails fast when objects bind to that datasource or are routed to it, or when it is boot-critical. Otherwise it is left unconnected with a warning. Before this change the same row booted and wrote its file in plaintext.

Blast radius, measured on this tree: no example, template, CLI scaffold or published skill authors the key, and no host default or environment variable sets it (a turso `encryptionKey` reaches the driver only from an authored `datasource.config`). Whether any out-of-repo deployment declares such a config is NOT measured and is not claimed to be zero.

<!-- adr-0087: registered turso-config-local-encryption-key-refused -->
