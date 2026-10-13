---
'@objectstack/metadata-protocol': patch
---

The legacy-organization boot report reports each of its reads on its own, and a stored row under a code-defined datasource name is named once at boot

Clause-②: no

- `[metadata_org_scoped_unserved]` reads `sys_metadata` and counts the legacy rows of `sys_metadata_commit`, `sys_metadata_history` and `sys_metadata_audit` as four separate terms. A read that fails for any reason but a missing table now costs only its own term: the line names it NOT MEASURED, with the reason, and still reports the other terms. Before, one failing read silenced the whole line.
- `[metadata_sealed_overlay_unserved]` no longer lists an environment row stored under the name of a datasource the host defines in code. The datasource restore's boot warning already names that row, with its own remedy, so the row was named twice. No read serves the row either way, and nothing is deleted or rewritten.
