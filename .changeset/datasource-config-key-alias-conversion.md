---
"@objectstack/spec": minor
"@objectstack/service-datasource": minor
---

feat(spec,service-datasource): graduate the driver factory's four legacy `datasource.config` `??` fallbacks into an ADR-0087 conversion (#4456)

`createDefaultDatasourceDriverFactory` still carried four undeclared read-side
`??` fallbacks that predate the #4410 config gate: sqlite `file`/`database`
(canonical `filename`), postgres/mysql `connectionString` (canonical `url`),
postgres/mysql/mongo `user` (canonical `username`), and mongo `uri` (canonical
`url`). They were never part of the contract — no schema, form, doc or example
ever named them — and they kept working only because the reader was lenient
(AGENTS.md Prime Directive #12 debt).

**FROM → TO, applied automatically at load** by the new conversion entry
`datasource-config-driver-key-aliases` (retired-from-load-path; replayed over
stored `sys_metadata` rows by `applyConversionsToStoredItem` and by
`os migrate meta`):

- sqlite / sqlite-wasm: `config.file` / `config.database` → `config.filename`
- postgres / mysql: `config.connectionString` → `config.url`, `config.user` → `config.username`
- mongo: `config.uri` → `config.url`, `config.user` → `config.username`

The mapping is driver-aware — `database` renames only under sqlite, where it
aliased the file path; for postgres/mysql/mongo it is a canonical key and is
untouched. A canonical key already present wins; the legacy alias is left
shadowed (the factory's `??` precedence, preserved).

**Behaviour change (the deletion):** the factory now reads exactly one spelling
per key. A `DatasourceConnectionSpec` handed to the factory *directly* with a
legacy spelling is no longer honoured — authored metadata was already rejected
by the per-driver zod gate with a rename hint (#4410), and stored runtime
datasource rows are canonicalized at every rehydration seam (including the
`sys_metadata` restore path in `DatasourceAdminServicePlugin`, which now
replays the full conversion chain), so no supported path still produces the
legacy shape. One-line fix for hand-built specs: use the canonical key from
the table above.
