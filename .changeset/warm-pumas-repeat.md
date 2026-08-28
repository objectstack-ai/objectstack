---
"@objectstack/cli": patch
---

`os migrate plan` / `os migrate apply` now diff the object set the deployment actually serves

Both commands booted `createStandaloneStack` and nothing else, so on any real deployment they examined a five-table subset — `sys_metadata`, `sys_metadata_audit`, `sys_metadata_commit`, `sys_metadata_history`, `sys_view_definition` — and reported `0` drift over it. The host `objectstack.config.ts` was never loaded (the standalone stack says so itself) and no platform plugin was composed either: only the DATA subcommands reached `PlatformObjectsPlugin`, through `buildDataMigrationPlugins`.

That failed in the direction that reads as success. With nothing registered there is no drift, so `plan` printed *"Physical schema is in sync with metadata — nothing to migrate."* — while the driver's own boot-time detector, running with the full registered object set, reported findings on the same database whose message ends `run "os migrate apply"`. Measured against a control plane carrying roughly eighty `sys_*` tables: ten boot-time findings, five tables examined, "in sync".

`plan` and `apply` now compose what `os serve` composes: the host config's plugins (plus `AppPlugin(config)` when the config carries top-level metadata and brings no app plugin of its own), and `PlatformObjectsPlugin` — the one plugin `serve` injects unconditionally. Both commands compose identically, so the plan an operator reads and the set `apply` reconciles are the same.

Nothing about what counts as drift changed. A plan that now reports findings it used to hide is the fix working.

Two behaviours worth knowing:

- **Host plugins are composed for their DECLARATIONS only** — `init()` runs, `start()` does not. `os migrate plan` is a declared dry run, and host plugins are arbitrary code: composed fully, `SecurityPlugin` alone attempted fourteen inserts into `sys_permission_set` during a plan, from its `start()` bootstrap. The kernel contract puts object declarations in `init()`, which is all a schema command needs. The residue: a plugin that registers its objects in `start()` instead of `init()` stays outside the plan.
- **A project with neither an `objectstack.config.*` nor a compiled artifact is unchanged** — five tables, same output, same `--json` document. There is no deployment there to mirror.

A host config that exists but fails to load (a missing environment variable is the common case) is reported loudly on stderr and does not fail the command; `os migrate plan --json` then carries `composition.hostConfigLoaded: false`, because the table count alone cannot tell that apart from a deployment that is genuinely small.
