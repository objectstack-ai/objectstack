---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): on PostgreSQL, the NULL-safe row identity of `sys_setting` and `sys_notification_preference` now lands, and a tightening that did not land is reported instead of answered `created`

Clause-②: no
Metadata-protocol: none

On PostgreSQL the declared unique both tables start with is a UNIQUE CONSTRAINT (the driver builds it with knex `table.unique()`), not a bare index. The boot migration that replaces it with the NULL-safe key ran `DROP INDEX` on the constraint's index, which PostgreSQL refuses (2BP01, printed on every boot), and then `CREATE UNIQUE INDEX IF NOT EXISTS` under the name the constraint still held, which succeeds as a no-op. Both migrations reported `created` while the plain, NULL-distinct key stayed: two tenant-scope or global-scope settings rows for one (organization, namespace, key) could coexist.

- **The drop.** On PostgreSQL the replace step now frees the name the way the driver's own `dropIndexIfExists` does: `ALTER TABLE … DROP CONSTRAINT IF EXISTS`, then `DROP INDEX IF EXISTS`. No `CASCADE`.
- **The verdict.** On PostgreSQL `created` is answered only after the definition under the real name reads back (`pg_get_indexdef`) equal to the one the probe built. When it does not (something depends on the old constraint and the drop is refused), the boot prints the existing `[metadata-protocol] could not rebuild …` line naming what is not enforced, with the refusal, and keeps running.
- **Existing duplicates.** When rows already break the NULL-safe key, nothing is deleted or merged and the old key stays, as before. The `cannot tighten …` line now also says how many keys are duplicated and how many rows hold them, on every dialect. It prints no row values.
- SQLite and MySQL run the same probe, drop and create statements as before, with the same outcomes. The only new statement there is the count, and it runs only on a conflict.
