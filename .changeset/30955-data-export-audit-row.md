---
'@objectstack/plugin-audit': patch
'@objectstack/rest': patch
---

feat(audit): every data export writes one run-level `sys_audit_log` row, and the `export` action comes back with its writer

Clause-②: yes (widening)
Metadata-protocol: none

`GET /data/:object/export` used to leave the compliance ledger nothing to say: a user could download up to 50,000 rows of any object they may export, `sys_audit_log` included, and no row recorded who, what or how much. Each export the door streams now writes one row with `action: "export"`, the object, `record_id: null` and the exporter (user, actor, tenant, and the agent or impersonator when there is one). Its `metadata` carries the format, the row count, the effective and requested limit and whether the 50,000 cap clipped it, whether the file was truncated at the limit, a bounded summary of the filter (field names and operators, at most 32 terms, never a comparand), whether a search term narrowed it (never the term) and the outcome. An export whose read fails after the checks records `outcome: "failed"` with the status and machine code it answered.

A request refused before anything is read (no export permission, a bad parameter, an unparseable filter) writes no row; neither does the import template. The row is written after the file is finished, so the audit write never changes or delays the download; a ledger write that fails is logged at `error` once per cause and the export is unaffected.

`export` is declared again on `sys_audit_log.action` (it was retired under #8147 because nothing wrote it) and is shown by the `config_changes` list view beside `config_change` and `import`. The writer lives on the `audit` service slot as `recordDataExport`, beside `recordAuthEvent` and `recordActionInvocation`; a kernel without the audit plugin exports exactly as before.
