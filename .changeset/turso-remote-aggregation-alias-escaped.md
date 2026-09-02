---
"@objectstack/driver-turso": patch
---

fix(driver-turso): escape the aggregation alias instead of gating it, so remote-mode analytics cube queries stop 500ing (#14113)

`RemoteTransport.aggregate` (Turso **remote** mode) held the aggregation
`alias` to `SAFE_IDENTIFIER` (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`). A dot fails that
regex. Every analytics measure is named `<cube>.<measure>` on the wire and
`ObjectQLStrategy` uses that name verbatim as the aggregation `alias`, so
**every** cube query that reached this face threw
`RemoteTransport: unsafe identifier rejected: "showcase_delivery.count"` — a
bare `Error` with no `code` and no `status`, which `mapDataError` then served
as an opaque 500 for a query that is spelled correctly.

The alias is now **escaped rather than gated**: it may be any string, and the
quote character is doubled (`"` → `""`), the standard escape inside a quoted
SQL identifier. This is the ALIAS half of the distinction `driver-sql` drew at
**#13714**, where the same position routes through knex's `wrapIdentifier`
(`SqlDriver.aliasIdentifierSql`) — a qualified **reference** must be
validated, a single output **name** must be quoted and escaped.
`AggregationNodeSchema` declares `alias: z.string()`, an output-column key,
and the in-memory, MongoDB and (post-#13714) SQL faces all project it
verbatim; this face was the outlier.

⛔ **Not** "drop the check". The alias reaches the statement raw inside
`AS "…"`, so an alias containing a `"` would close the quoting and continue as
grammar. `bucket"; DROP TABLE deal; --` now compiles to the single inert
column name `"bucket""; DROP TABLE deal; --"` and is returned as a column
name, executed against a real SQLite-backed client rather than asserted as a
string — the only instrument that tells "escaped" apart from "broke out".

The `field` and `object` positions keep `assertSafeIdentifier` unchanged: those
become column and table **references**, which are grammar. Default aliases are
byte-identical (`count_all` still spells itself the same way), and the
`groupBy` alias position is untouched by this change.
