---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli,runtime): the organization-ownership refusal from `os start --home` / `-d` names the database it refused

Clause-②: yes (widening) — `@objectstack/runtime`'s published `OrganizationOwnershipBootGuardOptions` gains one optional member, `databaseUrl`, and the refusal's two ceremony commands carry `--database-url` when the boot's database came from `os start`'s `-d` or a `--home` home. What `os start`, `os serve` and `os migrate organization-ownership` accept or refuse is unchanged.
Metadata-protocol: none

`os start` resolves its database with two inputs the ceremony never sees: its `-d` flag and its `--home` flag. When a boot on such a database was refused for its organization-ownership shape, the refusal printed `os migrate organization-ownership --out PLAN` (and the `--apply` command) with no database, so run as printed in the same directory the ceremony planned the project's own database, or found none ("holds none of the platform tables"), and the database that was refused stayed as it was. On a tree that also holds a pre-18 project database, the printed apply would have upgraded that one instead.

`os start` now hands its `serve` child, on an internal channel, the database it resolved whenever `-d` or a `--home` home chose it, and the boot guard names it in both commands: `os migrate organization-ownership --database-url file:/srv/os/home/data/objectstack.db --out PLAN`. A database the ceremony already reaches on its own (`$OS_DATABASE_URL`, the project's declared datasource, the project's `.objectstack` or an exported `$OS_HOME`) is named as before, with no `--database-url`.

A database URL that carries a credential (a password, or a token in its query) is never printed: the commands read it as `--database-url "${OS_DATABASE_URL:?…}"`, the refusal says to export it, and the shell stops with that message when the variable is unset rather than planning another database. `OrganizationOwnershipBootGuardOptions` (`@objectstack/runtime`) gains the optional `databaseUrl` that carries it.
