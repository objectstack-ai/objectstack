---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata-protocol, objectql): an operator upgrading an 18.3.0 database reads one answer per finding and the right count of activation ledger rows

Clause-②: no
Metadata-protocol: none

Four readings on the upgrade path of the activation ledger (`sys_metadata_activation`), each measured on a database `@objectstack/cli@18.3.0` wrote:

- **The plan's row count.** Before any boot of this release, `os migrate plan` said `1 row(s) name no package` while four rows named none: the number was the rows the next served boot binds. The line now counts every row that names no package, says how many of them the next served boot binds, and gives the reason each other row stays as it is (an item the environment authored, a name nothing holds, a position, a name two packages hold, an item with two rows). Who sees it: an operator reading `os migrate plan` (or any one-shot command) before the first served boot of this release.
- **The conflict sentence.** On a database holding two package-less rows for one item, the boot's `error` line said the rows were "for one item the environment authored", also when a package holds the item. It now says they are rows that name no package, for an item the environment authored or a package's item whose rows predate the ledger's package key, and points to the backfill's line, which names the package.
- **No raw driver line before that sentence.** The boot printed the SQL driver's raw `DATABASE_ERROR … UNIQUE constraint failed` warning ahead of it. The migration now counts the colliding rows before it sends the build, so the refusal it expects is never provoked. A count that cannot be read builds as before, and any other refusal still reaches the operator with the driver's text.
- **No raw driver line on the pre-upgrade plan.** `os migrate plan` printed `DATABASE_ERROR … no such column: permission_set_package` (and `connector_package`) because it ran the package-less guards' listings on tables whose scope column a schema sync has not added yet. The pre-flight now asks the catalog for the column first and, when it is missing, answers `unreadable` with a sentence naming the column; the plan's line and `os migrate duplicates` say so in place of the dialect error. A dialect with no catalog arm runs the listing as before.

No status, code or exported shape changes; no row is written differently.
