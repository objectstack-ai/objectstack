---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli,runtime): the organization-ownership refusal names the database for `os dev -d`, and the driver and token `os start` / `os dev` were given by flag

Clause-②: yes (widening) — `@objectstack/runtime`'s published `OrganizationOwnershipBootGuardOptions` gains two optional members, `databaseDriver` and `databaseAuthTokenFromFlag`, and the refusal's two ceremony commands set `OS_DATABASE_DRIVER` and `OS_DATABASE_AUTH_TOKEN` in front when `--database-driver` / `--database-auth-token` chose them; `os dev`'s `--dev` commands carry `--database-url` when `-d` chose the database. What `os dev`, `os start`, `os serve` and `os migrate organization-ownership` accept or refuse is unchanged.
Metadata-protocol: none

`os dev -d URL` served the database `-d` chose, but when the organization-ownership boot guard refused it, the refusal printed `os migrate organization-ownership --dev --out PLAN` (and the `--apply` command) with no database, and `os dev`'s own line for a database it does not upgrade in place (anything that is not a local SQLite file) repeated that bare spelling. Run as printed, the ceremony planned the project's default database instead. `os dev` now hands its `serve` child the database it resolved through the same internal channel `os start` uses (#31488), so both commands read `os migrate organization-ownership --dev --database-url URL …`, a URL with a credential read from `"${OS_DATABASE_URL:?…}"` as before. `os dev`'s own line now points at the two commands the refusal names instead of spelling a bare one.

`os start` and `os dev` put `--database-driver` and `--database-auth-token` in the child's environment only (`OS_DATABASE_DRIVER`, `OS_DATABASE_AUTH_TOKEN`), and the ceremony reads those two variables (it has no flag for either), so the printed commands opened the database with another driver or without its token. They now set both in front of the command: `OS_DATABASE_DRIVER=turso OS_DATABASE_AUTH_TOKEN="${OS_DATABASE_AUTH_TOKEN:?…}" os migrate organization-ownership …`. The token is never printed and never reaches the guard: the command re-exports the shell's own `OS_DATABASE_AUTH_TOKEN`, the refusal says to export it, and the shell stops with that message when it is unset. A driver or token the operator exported themselves is in their shell already and is not repeated.
