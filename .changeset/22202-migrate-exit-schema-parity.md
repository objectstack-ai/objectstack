---
"@objectstack/cli": patch
---

fix(cli): `os serve --no-server` with `OS_MIGRATE_AND_EXIT=1` now creates every table the same config's server boot registers, `sys_import_job` included

Clause-②: no

- **What was wrong.** `serve` composed the REST API plugin only with the HTTP server on. That plugin's `init()` registers `sys_import_job`, the object the async-import routes write to, and schema sync creates tables only for the objects registered in that boot. So a migrate-and-exit run with `--no-server` created one table fewer than the server boot it prepares for. A deployment that migrated "kernel only" and then served with schema sync off had no import-job table for the async-import routes to write to.
- **What changes.** `serve` composes the REST API plugin on every boot, as it already composes the storage, settings, sharing and auth plugins. With `--no-server` its object registers. With no HTTP server in the boot, its `start()` mounts no route and prints one `warn` that the server is absent, as those plugins do. On `examples/app-todo` the `--no-server` run now creates 70 tables, the same set as the server boot.
- **What does not change.** `--no-server` still adds no HTTP server plugin and no dispatcher. A server boot composes the same plugins in the same order as before. The no-auth boot refusal still applies only with the server on.
- **One composition behaves differently.** A config that puts its own HTTP server plugin in `plugins` and runs `--no-server` now gets the REST routes on that server, as it already got the settings and auth routes. Anonymous data access stays denied there: an unauthenticated `GET /api/v1/data/OBJECT` answers `401`.
- **If you worked around it** by dropping `--no-server` from your migration step, either form now provisions the same schema.
