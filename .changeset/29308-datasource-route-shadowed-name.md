---
'@objectstack/spec': minor
'@objectstack/service-datasource': patch
---

fix(spec)!: a datasource named `drivers` is refused at every door that parses a datasource, not only at the admin create door

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none in `skills/**` — `skills/objectstack-data/rules/datasources.md` teaches `default` as host-reserved and no file under `skills/**` declares or shows a datasource named `drivers`; every taught use stays true. Docs: `content/docs/data-modeling/drivers.mdx` said `drivers` was reserved at the admin API only; it now names the schema refusal and every door.

**BREAKING** for a datasource named `drivers`.

- **Before.** The datasource admin API mounts the driver catalog at `GET /api/v1/datasources/drivers`, ahead of the by-name read `GET /api/v1/datasources/:name`, so a datasource named `drivers` can never be read by name (its Setup edit form never loads). The admin create door (`POST /api/v1/datasources`) refused the name, but `DatasourceSchema.name` accepted it, so the same unreachable datasource was still declared in code (`defineDatasource`, a stack's `datasources`) and saved through the metadata save door (`PUT /api/v1/meta/datasource/drivers` answered 200).
- **Now.** `DatasourceSchema.name` refuses every name in the new export `ROUTE_SHADOWED_DATASOURCE_NAMES` (`@objectstack/spec/data`, today `['drivers']`) with one `invalid_format` issue at `name`: `Datasource name 'drivers' is reserved: the datasource admin API serves its own route at /api/v1/datasources/drivers, ahead of the by-name read /api/v1/datasources/:name, so a datasource of that name could never be read by name. Pick another name.` So `defineStack`, `os validate`, `os build` and the metadata save door (422 `INVALID_METADATA`, nothing stored) all refuse it. The published JSON Schema carries the refusal as a second `pattern` on `name`.
- **One list.** `@objectstack/service-datasource` now reads the spec's list: the admin registrar mounts the driver catalog from a segment typed as a member of it, and the create door refuses each name in it, as before.
- **Not changed.** `default` (the host's primary datasource row still parses; a stack still may not declare it), `test`, and names that only contain the word (`driver`, `drivers_archive`, `my_drivers`).
- **Stored rows.** A stored datasource row named `drivers` still loads, with `_diagnostics` reading `valid: false` and carrying the refusal, and its next metadata save is refused. Through the admin door it stays listed and removable, and a `label`/`active`-only edit still saves. Nothing rewrites it: the new name, and every object that routes to it, are the author's call. The upgrade guide entry is `datasource-name-route-shadowed-refused`.
- **The remedy.** Rename the datasource (for example to `driver_registry`) and point every object `datasource` / `datasourceMapping` rule that names it at the new name.

<!-- adr-0087: registered datasource-name-route-shadowed-refused -->
