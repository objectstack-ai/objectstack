---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a MySQL `date` field reads back the day it stores, so a year below 100 no longer comes back a century late (#20280)

Clause-②: no

On MySQL the driver took mysql2's JS `Date` for a `DATE` column. mysql2 rebuilds it from the three stored numbers with `new Date(Date.UTC(y, m - 1, d))`, and `Date.UTC` reads a year from 0 to 99 as 1900 + year. The write was right and the read was wrong: `where placed_on $eq '0009-03-04'` found the row, then presented it as `1909-03-04`. Measured on MySQL 8.0.46 (server `time_zone='+08:00'`), on records created through `POST /api/v1/data/:object`:

| stored (`CAST(… AS CHAR)`) | `find` / `findOne`, the engine, `…/query`, `GET …/:id`, a `groupBy` key, `min`, `distinct`: before | now |
|:--|:--|:--|
| `0009-03-04` | `1909-03-04` | `0009-03-04` |
| `0099-03-04` | `1999-03-04` | `0099-03-04` |
| `0000-06-15` | `1900-06-15` | `0000-06-15` |
| `0999-06-15` | `0999-06-15` | `0999-06-15` |
| `2026-03-04` | `2026-03-04` | `2026-03-04` |

The MySQL connection now asks mysql2 for a `DATE` as its `YYYY-MM-DD` wire text (`dateStrings: ['DATE']`), and the read doors present that text through `temporalStorageForm`, the rule the write and `where` paths already use. PostgreSQL has read a day as text the same way since its calendar-day parser.

**Unchanged**, measured identical before and after on MySQL through the driver, the engine and REST: every read of a year from 1000 to 9999 on a `date`, `datetime` or `time` field, and of a `TIMESTAMP` column and a `null`, on `find`, `findOne`, `count`, `aggregate` (`min`, `max`, `groupBy`), `distinct` and a write-then-read; every `$eq` / `$gt` answer. SQLite and PostgreSQL reads do not move.

**Also moved, on MySQL only:**

- A raw `execute()` read, and a `DATE` column read under a field that is not declared `date`, now receive the `YYYY-MM-DD` text where they received a `Date` (a `datetime` column still arrives as a `Date`). PostgreSQL already answers a `date` column this way.
- A zero day (`0000-00-00`, storable only with `NO_ZERO_DATE` off) is presented as that text, where mysql2 made up `1899-11-30`.
- A connection whose host already set `dateStrings` is left as the host set it.

**Not changed:** a `datetime` field. A MySQL `DATETIME` in years 0..99 still reads a century late (`0009-03-04T10:00:00.000Z` comes back as `2004-09-03T10:00:00.000Z`). ADR-0053 D-F2 keeps the client parser's `Date` for an instant, so that half stays open on #20280.
