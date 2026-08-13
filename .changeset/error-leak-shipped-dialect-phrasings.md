---
'@objectstack/types': patch
---

Withhold the Postgres and bare-SQLite phrasings of a driver failure from HTTP error bodies

`looksLikeInternalErrorLeak` recognised SQLite's `SQLITE_ERROR: no such table: sys_metadata`
but not the Postgres phrasing of the same condition, `relation "sys_metadata" does not exist`.
The result was that one failure disclosed a physical table name or not depending on which
engine was underneath, from every boundary that applies the predicate — `HttpDispatcher.error`,
the declarative endpoint executor, the dispatcher plugin, the direct-mount package door and the
Hono auth-config route.

The predicate now also recognises, for the engines this repo actually runs:

- Postgres `relation "…" does not exist` and `column "…" does not exist` (42P01/42703), which
  covers the `… of relation "…"` sub-object family as a superstring;
- Postgres `permission denied for table|relation|sequence|database …` (42501);
- SQLite/libsql `no such table:` / `no such column:` in their bare, un-prefixed form.

Each phrasing is anchored on the driver's own template — a quoted identifier, or the trailing
colon — never on the bare tail, so ordinary business messages such as "user does not exist" are
still returned to the caller unchanged. The predicate is applied only where the outcome is
already a 5xx, and the full text still reaches the server log and the error reporter.
