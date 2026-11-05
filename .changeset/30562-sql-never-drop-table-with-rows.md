---
'@objectstack/driver-sql': patch
---

fix(driver-sql): schema sync never drops an existing table that holds rows; a `_id`-keyed table with rows is refused, naming the table and the column

Clause-②: yes (narrowing) — `SqlDriver.initObjects` / `syncSchema` refuse one more case that used to succeed: an existing table that has a `_id` column, no `id` column and at least one row. It used to be dropped and recreated empty; it is now refused with an `ExistingTableAdoptionRefusal` naming the table, the column and the row count, and nothing is changed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored metadata changes: what moves is what schema sync does to a database table it finds, and the refused table is left exactly as it was, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing in schema sync (`@objectstack/driver-sql`): a table the sync would have rebuilt is refused while it holds rows.

- **Before.** Schema sync adopts an existing table by adding the columns the object declares and the table lacks, rows kept. A table keyed by `_id` with no `id` column (the storage key of the ObjectQL driver this one was ported from) was instead dropped and recreated as the object declares, whatever it held. Storing an object on a managed datasource over an existing database reached it: an object named after such a table deleted its rows, and the save answered success.
- **Now.** That rebuild runs only on an empty table, as before. A table that holds rows is refused before anything is written: no column is added, no index is built, no row is touched. The refusal is thrown from `initObjects` and reaches the caller of the sync. The metadata save, the boot sync and a datasource connect report a refused sync in the server log at `error`, followed by this message, as they do for any refused sync.
- **Who moves.** Only a deployment storing an object on a managed SQL datasource whose table of the same name is keyed by `_id` and holds rows. No platform table has that shape.

**The remedy.** To keep the rows and use the table, rename its `_id` column to `id`, then save the object again (or restart). To read the table as it is, bind the object through a datasource whose `schemaMode` is `external`. If the rows are not needed, empty the table and save again; the sync then rebuilds it.
