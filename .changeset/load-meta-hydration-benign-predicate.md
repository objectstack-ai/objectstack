---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): boot hydration classifies "store not provisioned yet" by error type, not by a copied message regex (#5841)

`loadMetaFromDb` — the boot step that hydrates `sys_metadata` overlay rows into
the SchemaRegistry — decided whether a failed read was the benign first-boot
case by running its own `/no such table/i` over `e.message`. That was a second,
hand-copied vocabulary of "which driver errors are benign", sitting a few
thousand lines below the first: the same file already imports
`isMissingTableError` from `@objectstack/metadata/errors` and asks it in
`rethrowUnlessMetadataStoreUnprovisioned` (#5532), as do this package's
`SysMetadataRepository` (#4867) and `DatabaseLoader` (#5108).

A copy is wrong in both directions, and only one of them is loud:

- **SQLite** says `no such table: sys_metadata`, which the copy matched — by
  luck of which driver the author was running.
- **PostgreSQL** says `relation "sys_metadata" does not exist` (SQLSTATE
  `42P01`) and **MySQL/MariaDB** says `Table 'app.sys_metadata' doesn't exist`
  (errno 1146). Neither matches the regex, so a perfectly healthy first boot on
  either driver printed `[Protocol] DB hydration skipped: …` — a warning about
  a working system that no operator can act on.
- Conversely, any driver phrasing a *different* failure as "no such table" was
  read as benign and swallowed without a line.

The seam now asks `isMissingTableError`, so the classification follows driver
`code` / `errno` / message / one step down the `cause` chain, and a driver quirk
is taught to the platform once. Observable change for operators: no spurious
first-boot warning on Postgres/MySQL, and a real failure that happens to be
worded like a missing table is no longer silently benign. The warning line also
reports non-`Error` rejections properly instead of printing `undefined`.

Not changed here: a non-benign read failure is still answered with a
`console.warn` plus `{ loaded: 0, errors: 0, invalid: 0 }`, so the return value
still cannot distinguish "the store holds no overlay rows" from "the store could
not be read" (ADR-0110 D3, on the boot side). That is a change to the method's
return contract and to its consumer in `ObjectQLPlugin.restoreMetadataFromDb`,
and is tracked separately as #5841 fact 2.
