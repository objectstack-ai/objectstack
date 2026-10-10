---
'@objectstack/cli': patch
---

fix(cli): `os migrate plan`'s unmanaged-tables sweep runs whenever the plan's object set mirrors what `os serve` registers, covers every database the plan diffs, and states only a reason that holds when it does not run (#22580)

On a project with a compiled artifact and no `objectstack.config.ts`, `os migrate plan` composes what `os serve` registers, platform included. The sweep for platform-prefixed tables that no object declares was still withheld there (`unmanagedTables.status: "unreadable"` in `--json`), with a reason claiming the plan's object set was only the artifact plus the platform floor. On a project with neither a config nor a compiled artifact, the same untrue reason was given.

The plan's composition now records whether its object set mirrors the served boot, and why when it does not. The sweep runs exactly when it does, the compiled-artifact project included. When it does not run, the `detail` names the composition's own reason: the host config that did not load, or a project with neither a config nor a compiled artifact.

The sweep also reads every database the plan diffs. Where the serving boot keeps lifecycle-classed objects in the `telemetry` sibling database, a table stranded there is now reported too, where before the sweep answered `read` over the primary database alone. A sibling whose catalog cannot be read makes the whole sweep `unreadable`, and the `detail` names that database. The `--json` shape of `unmanagedTables` is unchanged. `physicalTables` counts the tables of every database swept, and the human line says "in the database(s) this plan covers".
