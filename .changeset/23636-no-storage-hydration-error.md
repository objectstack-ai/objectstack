---
'@objectstack/objectql': patch
---

fix(objectql): the boot hydration ERROR names the storage remedies when no datasource is declared and no driver is registered, instead of sending the operator to a datasource nobody configured

Clause-②: no

When `sys_metadata` cannot be read at boot, objectql logs one `error` line that says what was not restored and what to fix. The fix half was always "check the datasource behind sys_metadata — connection, credentials, and that the table exists". On a deployment with no datasource declared and no driver registered (a production `os serve` with no `OS_DATABASE_URL`, for one) there is no datasource to check and no credential to fix.

- **Before.** `ERROR sys_metadata could NOT be read at boot — persisted metadata was NOT restored, … Fix: check the datasource behind sys_metadata — connection, credentials, and that the table exists — then restart.`
- **After, when nothing serves `sys_metadata`.** `ERROR sys_metadata could NOT be read at boot — no storage is configured: no datasource is declared and no driver is registered, so nothing serves sys_metadata. Persisted metadata was NOT restored, … Fix: set OS_DATABASE_URL (e.g. file:./data/app.db, or a postgres:// or mysql:// URL); mount a storage driver in the stack's plugins (e.g. new DriverPlugin(driver) from @objectstack/runtime); or run with --dev (an in-memory SQLite store, for development) — then restart.` The three fixes are the ones the CLI's `⚠ No storage:` line names.
- **Unchanged.** The level stays `error`, and the consequence sentence is the same word for word. The datasource remedy stays for every case where a datasource exists: a registered driver whose read failed, `sys_metadata` bound to a named datasource with no driver, and a declared datasource the connection layer could not use. Which line prints is read from the engine's routing, not from the text of the error the read raised.
