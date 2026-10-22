---
'@objectstack/driver-sql': patch
---

fix(driver-sql): on a database the organization-ownership ceremony has not certified, the boot's drift line for an orphaned `organization_id` column names the ceremony instead of `os migrate apply --allow-destructive`

Clause-②: no (operator log line text only)
Metadata-protocol: none

A 17.x database booted on 18.x printed one `[schema-drift]` line per `organization_id` column ending `— "os migrate apply --allow-destructive" to drop it.`, during `os serve` and `os migrate apply --yes`. That command is refused on such a database: the drop is the ceremony's (ADR-0131 D10 item 5). The boot now asks the driver's own reader, `isTenantKeyCertified()`, once per table that has such a drop. When the answer is "not certified", the line keeps the finding and replaces that sentence with `— a drop the organization-ownership ceremony owns, and it has not verified on this database: run "os migrate organization-ownership", which drops it itself.` These are the words `os migrate plan` shows under the same entry.

A certified database prints the same line as before. So does every other column and every other drift kind. Nothing the boot applies or skips changes.
