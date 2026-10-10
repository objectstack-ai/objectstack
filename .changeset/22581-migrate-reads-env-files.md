---
'@objectstack/cli': patch
---

fix(cli): `os migrate` reads the project's `.env` files as `os serve` does, and names the database it opened and who named it (#22581)

`os serve`, `os start` and `os dev` load the project's `.env*` files before they read any variable. `os migrate` read only the process environment. So a project keeping `OS_DATABASE_URL` in `.env` served one database and migrated another: `os migrate plan` reported `.objectstack/data/objectstack.db` while `os serve` opened the `.env` database. An `OS_AUTH_SECRET` kept in `.env` left the auth family (`sys_user`, `sys_account`, …) out of the plan.

Every command that boots the one-shot schema stack now loads the same files first, through the same `dotenv-flow` call, with `os serve`'s mode rule: `NODE_ENV`, else `production`, and `development` for `os migrate security-catalog-overlays --dev`, which composes as `os serve --dev`. That covers every `os migrate` subcommand, and also `os meta resync`, `os secret rewrap`, `os secret orphans` and `os storage orphans`. A variable exported in the shell still wins over `.env`, as it does for `os serve`. The SQLite occupancy check that `os migrate apply` and the other write commands run before booting reads the same files, so it checks the database the command is about to migrate.

This supersedes two phrasings in this release's `os migrate plan` / `apply` auth-family entry: `os migrate` now does read the project's `.env` files, and the deployment's `OS_AUTH_SECRET` composes the auth family whether it is exported or kept in `.env`.

`os migrate plan` and `os migrate apply` print the database with its source: `--database-url`, a variable from the process environment, a variable from a named `.env` file, the config's default datasource, or the default. In `--json` the source is the new `databaseSource` field (`{ kind: 'flag' | 'process-env' | 'env-file' | 'config-datasource' | 'default', variable?, file?, datasource? }`). `apply` now carries `database` and `databaseSource` on every payload after the boot, including `in_sync`, `nothing_safe_to_apply` and `confirmation_required`.
