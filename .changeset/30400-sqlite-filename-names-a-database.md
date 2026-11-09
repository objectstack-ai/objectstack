---
'@objectstack/spec': minor
'@objectstack/service-datasource': minor
---

fix(spec)!: a SQLite datasource's `config.filename` must name a database: `''` and a name that starts with `:` without being exactly `:memory:` are refused by the stack parse and the metadata save door, not only by the datasource admin doors

Clause-②: no (narrowing) — `SqliteConfigSchema.filename` and `SqliteWasmConfigSchema.filename` refuse `''` and any `:`-prefixed value other than exactly `:memory:`, so `defineStack` / `os validate` / `os build` and `PUT /api/v1/meta/datasource/NAME` refuse a `sqlite` / `sqlite-wasm` datasource they accepted before. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` teaches no SQLite `filename` value, and `content/docs/**` teaches only `:memory:` and file paths, which stay accepted. The prescription ships in the refusal text, the FROM → TO below and the upgrade-guide entry.

<!-- adr-0087: registered sqlite-filename-names-no-database-refused -->

**BREAKING** accept-set narrowing on `SqliteConfigSchema.filename` and `SqliteWasmConfigSchema.filename` (`@objectstack/spec`), and so at every door that judges a datasource against the spec: `defineStack`, `os validate`, `os build` and `PUT /api/v1/meta/datasource/NAME`.

- **Before.** Both schemas typed `filename` as any placeholder-free string. `:memory:/srv/data/parts.db` (the New datasource dialog's prefilled `:memory:` with a path typed after it) and `''` parsed. Every layer reads a name that starts with `:` as fileless, so no file was ever opened: a `sqlite` datasource opened it as a relative path whose directory does not exist and every statement failed, and a `sqlite-wasm` one opened a throwaway in-memory database whose writes were gone at the next connect. The datasource admin doors (Test connection, create, update) already refused both; a datasource declared in a stack or saved through the metadata door was stored anyway, and the admin door's update would not take it back.
- **Now.** The parse answers one issue at `filename` (`config.filename` on a datasource, `datasources.N.config.filename` in a stack) that names the value, says why and prescribes the fix: `'…' is neither ':memory:' nor a file path. A name that starts with ':' is not read as a file, so this datasource would store nothing: use exactly ':memory:' …`, or `'' is empty and names no database file. …`. `defineStack` raises it as `STACK_SCHEMA_INVALID` (422); the metadata door answers `422 INVALID_METADATA`.
- **Unchanged.** Exactly `:memory:`, an absent `filename` (still defaulting to `:memory:`), and relative, absolute, Windows-drive and `file:` paths parse as before. Whether a path can be opened or created is still judged only at runtime, by the datasource admin doors; the schema cannot touch the file system.
- **`@objectstack/service-datasource`.** The admin doors give the same answers as before, word for word. The two arms the string alone decides now come from the driver-contract parse they already run, so `sqlite-database-filename.ts` keeps only its filesystem arm: one definition, in the spec.
- **`@objectstack/spec`.** The upgrade-guide entry `sqlite-filename-names-no-database-refused` (a semantic migration: no automatic rewrite, because whether the author meant an ephemeral database or the path typed after the prefix is a judgement about the datasource).

**FROM → TO.** `config: { filename: ':memory:/srv/data/parts.db' }` → `filename: '/srv/data/parts.db'` to keep the data in that file, or `filename: ':memory:'` for an ephemeral database; `filename: ''` → `':memory:'` or a file path.
