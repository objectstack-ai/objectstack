---
'@objectstack/driver-sql': patch
'@objectstack/service-datasource': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

`os migrate plan` no longer creates a database on a project that has never been started (#6743)

`migrate plan` is a dry run, and since #3917 it has reported the boot-time
create-table DDL and the artifact seed instead of performing them. It still
brought the database file itself into existence, though: SQLite creates the
file at open, so a `plan` in a fresh project left behind a 0-table
`.objectstack/data/objectstack.db` — a write side effect from a read-only
command, and one that erased the only signal ("no database file yet") by which
the next command can tell a never-started project from a started one.

A missing SQLite target is now opened as an empty in-memory database instead of
being created. **The plan output is unchanged**, deliberately: a database with
zero tables is exactly what a freshly created empty file is, so "every table
needs creating" — the true and useful answer for a new project — still prints,
and the `Database:` line still names the real target path rather than the
in-memory stand-in.

New driver capability, additive and off by default:
`SqlDriverConfig.sqliteAbsentFile` (`'create'` | `'empty-in-memory'`, default
`'create'`). Every existing caller keeps SQLite's own create-if-absent
behaviour. It is threaded to the driver as a host-composition option
(`createDefaultDatasourceDriverFactory`, `DefaultDatasourcePlugin`,
`createStandaloneStack`), not as an authorable `datasource.config` key — a
datasource must not be able to declare itself into never persisting.

`os migrate apply` deliberately does **not** use it: it boots deferred too, but
flushes the deferred DDL after confirmation and needs a real file to flush into.
