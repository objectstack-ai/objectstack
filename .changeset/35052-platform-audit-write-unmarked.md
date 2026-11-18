---
'@objectstack/plugin-audit': patch
'@objectstack/objectql': patch
'@objectstack/core': patch
---

fix(plugin-audit): the platform's own audit and activity rows are no longer judged as an automation's insert

Clause-②: no
Metadata-protocol: none

The audit writer records every audited write with a `sys_audit_log` row and its `sys_activity` mirror. It wrote both through the `sudo()` of the hook api it is handed, and `sudo()` spreads the audited write's context. When that write was made by app-authored automation, the elevation kept the automation's provenance: an action body's or a system hook's app-automation elevation mark, or a flow run's `flowRunId`. plugin-security therefore read the platform's own ledger rows as the automation inserting into an append-only object. Today that logged the "Deprecated: inserting into 'sys_audit_log'" (and `'sys_activity'`) warning on the first such write. Once the announced refusal of those inserts ships, it would have refused the rows and lost the audit trail of every action-body, system-hook and flow write.

- The audit writer now writes both rows through the platform's own system api. `platformSystemApi(api)` is a new export of `@objectstack/objectql` and `@objectstack/objectql/core`. It derives from a hook's api the same elevated context `sudo()` gives, minus the app-automation mark and minus `flowRunId`. Every other key is kept, so the rows stay in the write's transaction, organization and attribution.
- `withoutAppAutomationElevation(context)` is a new export of `@objectstack/core`. It returns the context without the mark.
- What an automation writes itself is unchanged. An action body's or a hook's insert into `sys_activity` or `sys_audit_log`, through its `ctx.api` or its `ctx.api.sudo()`, still carries the mark and still logs the deprecation. `sudo()` itself is unchanged too: it never sheds the mark.
