---
'@objectstack/cli': patch
---

fix(cli): `os migrate organization-ownership --apply` no longer blames the release for a column the ceremony's composition does not declare (ADR-0131 D10, column drops)

Clause-②: no

The ceremony drops `organization_id` only through the schema-drift ceremony, so only on an object its boot declares, and its boot declares the composition it is run in (the project directory and environment). Run in a composition that does not mount an object's provider, the step used to answer that table with "the object this runtime declares still carries the column … Run the ceremony with the release whose declaration drops it". That sentence was false: the object was not declared at all, and the same release drops the column wherever it is declared. Measured cases are `sys_flow_dispatch` without `requires: ['automation']`, `sys_presence` without `realtime`, and `sys_audit_log` without the auth family (no `OS_AUTH_SECRET`).

Such a table is now answered `not-declared`:

- the step still blocks and keeps the column;
- its blocker names the table and the remedy: re-run the ceremony where the deployment's composition is declared, from its project directory and environment (the `requires` capability whose provider declares the object, and `OS_AUTH_SECRET` for the objects the auth family declares);
- the `column-drops` step's summary counts these tables as `notDeclared` in the apply report (the report file and `--json`).

The "not proposed" blocker is unchanged. It is now given only for an object the composition does declare.
