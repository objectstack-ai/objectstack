---
'@objectstack/cli': patch
---

fix(cli): `os migrate plan` and `os migrate apply` examine the objects a `datasourceMapping` rule routes to a declared datasource, the declared default included, in that datasource, as `os serve` connects it (#24120)

Clause-②: no

A project whose primary store is a declared datasource routed as the default (`datasources: [{ name: 'qa_main', … }]` with `datasourceMapping: [{ default: true, datasource: 'qa_main' }]`) got a plan that examined nothing. The plan resolved `qa_main`'s database as its primary, but it registered no driver under the name `qa_main`, so every object the rule routes there, platform objects included, was bound to no driver. The plan printed `Examined 0 managed table(s)` and a PARTIAL plan. Meanwhile `os dev` on the same project reported drift in that database and named `os migrate` as the remedy.

- **Now:** `plan` and `apply` connect the project's declared **managed** datasources the way `os serve` connects them: through the same `datasource-connection` service, under the declared name, for the datasources a mapping rule routes objects to, an object binds to, or that set `autoConnect`. Each datasource that objects live in is diffed and applied beside the primary. A composition note names each one and its database, in both the human output and the `--json` output. On a `datasourceMapping`-default project, the plan's drift is the drift `os dev` reports there.
- **Not connected:** a datasource whose schema the remote owns (`schemaMode: 'external'` or `'validate-only'`). Its objects are federated, and a plan has no table on it.
- **Refused now:** a routed managed datasource that cannot connect fails `plan`, `apply` and `unmapped-columns` with the connect error `os serve` gives for it. It is no longer skipped with a PARTIAL plan. `OS_ALLOW_DRIVER_CONNECT_FAILURE` degrades it here as it does there.
- **`os migrate unmapped-columns` follows:** it filters the plan's own findings, so it composes the same datasources. On such a project it reads an object's unmapped columns from the declared datasource. Before, it refused with "not in the set os migrate plan diffs: it is bound to no driver".
- **Unchanged:** a project that declares no datasource gets the plan it got before. `os migrate security-catalog-overlays` and `organization-ownership` boot as before. The unmanaged-table sweep's `physicalTables` counts each database once, although the primary and a declared default resolved from it are two connections to one file.
