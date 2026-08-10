---
"@objectstack/runtime": minor
"@objectstack/cli": minor
---

fix(cli,runtime): one shared default-database resolution for `os dev` / `os start` / `os migrate` (#6469)

Three commands used to resolve three different default databases in the same
project directory — `os dev` → `.objectstack/data/dev.db`, `os start` →
`.objectstack/data/objectstack.db`, `os migrate *` →
`.objectstack/data/standalone.db` — and none consulted the project config.
Measured harm (hotcrm 17.0.0-rc.5): after `os start` + seed, `os migrate plan`
opened a fresh empty `standalone.db` it had just created and reported **22
tables of drift against a healthy database** — the inverted failure direction,
pointing an operator at rolling back a database that was fine.

Per the maintainer ruling (2026-08-08, archived on #6469), all three commands
now resolve through **one** shared function
(`resolveProjectDatabaseUrl`, exported from `@objectstack/runtime`):

1. explicit `--database` / `--database-url` / programmatic `databaseUrl`;
2. `OS_DATABASE_URL` / legacy `DATABASE_URL` / vendor `TURSO_DATABASE_URL`;
3. explicit in-memory driver selection (`--database-driver memory` /
   `OS_DATABASE_DRIVER=memory`) — no file default is imposed;
4. the datasource the project config declares as its default home (a
   `datasourceMapping` rule `{ default: true, datasource: <name> }` naming a
   declared datasource whose connection is URL-derivable);
5. the **unified default file `objectstack.db`** under the state dir
   (`OS_HOME` → `<projectRoot>/.objectstack` → `~/.objectstack`).

**Compatibility — an existing environment never looks like data loss.** When
the unified `objectstack.db` does not exist but a legacy `dev.db` or
`standalone.db` does, the command **reads the legacy file** and prints one
loud line naming exactly which file is being read and the `mv` command that
converges it on the unified name. No interactive prompt (CI-safe), nothing is
deleted or renamed automatically, and the probe order
(`objectstack.db` → `dev.db` → `standalone.db`) is identical across all three
commands — `dev.db` first among the legacies because it holds real dev data,
while `standalone.db` is most likely an empty artifact of the very fork this
fixes. An explicit `OS_DATABASE_URL` pins any file forever, unchanged.

Also per the ruling: `sqlite://` is now accepted as an alias of `file:` in
database-URL parsing (`sqlite://…` used to die under `os migrate` with
`Unsupported database URL scheme`); genuinely unsupported schemes keep their
precise refusal. Behavioural side effects of unification: `os dev` now honours
`OS_HOME` / `TURSO_DATABASE_URL` for its default like the other two commands
already did, `os dev --fresh`'s ephemeral file is named `objectstack.db`, and
`os db clean` targets the same unified resolution. The #3917
`sqlite-occupancy` guard's primary scenario (a dev server and `os migrate`
contending for one file) is now real under default paths — previously the two
never opened the same file, so the guard could not fire in the very scenario
its comment described.

The new cross-command pin (`unified-db-resolution.pin.test.ts`) asserts
`dev` / `start` / `migrate` resolve the SAME URL for the same project root in
every fallback state — the test whose absence let the fork live.
