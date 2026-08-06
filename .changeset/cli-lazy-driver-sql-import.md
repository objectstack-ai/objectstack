---
'@objectstack/cli': patch
---

CLI: load the SQL driver's schema-work classifier lazily, so an unbuilt driver no longer breaks command discovery (#5726)

`packages/cli/src/utils/schema-migrate.ts` statically value-imported
`isInPlaceSchemaWork` from `@objectstack/driver-sql`. oclif's `findCommand`
`import()`s every command module on every CLI invocation, and nine commands
reach that file (`meta:resync`, `migrate`, and seven `migrate:*`), so a
workspace whose `packages/drivers/driver-sql/dist` was not built printed nine
`MODULE_NOT_FOUND` blocks — naming nine commands the operator never invoked —
in front of whatever command they actually ran, and dropped all nine out of the
command table (`os migrate plan` answered `Command migrate:plan not found.`).

The import is now `await import('@objectstack/driver-sql')` at the point of use,
inside the two renderers that need the classifier. The classifier keeps its one
definition in the driver — it is a fact about `PendingSchemaWorkKind` and a copy
in the CLI could disagree, listing a row rewrite under the heading that promises
the work is never data-losing.

No user-visible behaviour change: this is local/worktree developer experience
only, and CI always builds before running the CLI. `renderPendingSchemaWork` and
`summarizePendingSchemaWork` — internal helpers, not part of the package's
public entry — are now `async`.
