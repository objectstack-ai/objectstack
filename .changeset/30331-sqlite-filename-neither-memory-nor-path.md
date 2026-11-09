---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: Test connection and Save refuse a SQLite filename that is neither `:memory:` nor a usable file path, where Test connection used to pass it

Clause-②: yes (narrowing) — `POST /api/v1/datasources/test`, `POST /api/v1/datasources` and a `PATCH /api/v1/datasources/:name` that touches `config` or `driver` refuse a `sqlite` / `sqlite-wasm` `config.filename` that is empty, starts with `:` without being exactly `:memory:`, or names a path that can be neither opened nor created. The test answered `ok: true` for the first two and the save stored all three; both now answer with the value and the reason (`result.ok: false` from the test, `400 DATASOURCE_ADMIN_ERROR` from the save), the envelope every invalid `config` already gets.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: SqliteConfigSchema still types filename as a string, and the build and meta doors judge it as before. A stored row keeps loading at boot as it did; only a write through the admin doors that touches its config is judged, so there is nothing at rest for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the datasource admin doors (`@objectstack/service-datasource`): a SQLite filename that names no usable database is refused by Test connection and by Save (#30331).

- **Before.** The New datasource dialog's `:memory:` with a typed path after it (`:memory:/srv/data/parts.db`) tested green. Every layer reads a name that starts with `:` as fileless, so the probe's missing-file check skipped it. Saved, a `sqlite` datasource then opened it as a relative path under the server's working directory whose directory does not exist, so every query failed while the health check answered `false` (which the probe did not read as a failure); a `sqlite-wasm` one opened an ephemeral in-memory database, so writes succeeded and were gone at the next restart. An empty filename tested green too, and a path under a regular file or in a directory the server may not write could be saved.
- **Now.** Test connection answers `ok: false` and Save answers `400 DATASOURCE_ADMIN_ERROR`, under `Invalid configuration for driver '…'`, with a `config.filename:` line that names the value and why: not `:memory:` and not a file path, empty, or the operating system's reason the file cannot be opened or created.
- **Unchanged.** Exactly `:memory:` tests green and saves. An existing database file tests green and saves. A creatable path that does not exist yet is still refused by the test (which never creates it, #27512) and accepted by Save, which creates it on connect. `turso` names its target as a url and is not judged here.

**The remedy.** Use exactly `:memory:` for an ephemeral database, or the path of a database file with nothing in front of it.
