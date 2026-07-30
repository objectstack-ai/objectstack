---
"@objectstack/cli": patch
"create-objectstack": patch
---

chore(cli,create-objectstack): scaffolds no longer name a driver (#4065)

`os init` and the `create-objectstack` blank template both listed
`@objectstack/driver-memory` in the generated `dependencies`. It was the only
driver named, which read as an endorsement — "this is the driver your app runs
on" — when it is in fact the **last-resort rung** of the dev step-down (native
`better-sqlite3` → WASM SQLite → mingo). A new project's first impression of the
data layer should not be the engine that enforces no primary keys, no
uniqueness, no `NOT NULL` and no column types.

It was also redundant: `@objectstack/runtime` already depends on `driver-sql`,
`driver-sqlite-wasm` and `driver-memory`, and every script in both scaffolds runs
through the CLI, which carries all four. Removing the line changes nothing a
generated project can do — `objectstack dev` still resolves SQLite by default,
and `OS_DATABASE_URL` still selects Postgres / MySQL / MongoDB.

Docs updated to match: the "packages you depend on" table in *Your first project*
no longer lists a driver row (it now says where drivers come from), and the
Memory Driver section of *Database Drivers* documents the opt-in persistence
default, carries a migration callout for the old `'auto'` behaviour, and points
test authors at in-memory SQLite. That section also claimed "Data is lost when
the process exits", which was simply false while `'auto'` was the default — it
wrote a file into the working directory.
