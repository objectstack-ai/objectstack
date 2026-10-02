---
'@objectstack/spec': minor
'@objectstack/plugin-audit': minor
---

feat(spec,plugin-audit): the compliance ledger's audit capability, `view_all_audit_log`, exempts its holder from the ledger's parent-record read gate; platform administrators hold it by default (#21260)

Clause-②: yes (widening)

- **The capability.** `PLATFORM_CAPABILITIES` (`@objectstack/spec/security`) gains `view_all_audit_log` ("View All Audit Log", `scope: 'org'`). It is seeded into `sys_capability` like every other curated capability, and a permission set grants it through `systemPermissions`. It is a platform capability, so an app that declares a capability of the same name cannot bind a set carrying it to the `everyone` or `guest` anchor.
- **Who holds it.** `ADMIN_FULL_ACCESS_CAPABILITIES` (`@objectstack/spec`) now lists it, so platform administrators hold it by default: through the `admin_full_access` grant, and through the envelope a configured platform owner resolves to. No other shipped permission set carries it. Any other position holds it only through a permission set that grants it.
- **What it does.** A read of `sys_audit_log` keeps only the rows whose parent record the caller can read. The holder skips that gate and is served every ledger row its grant on `sys_audit_log` reaches: rows about deleted records, sign-out rows, sign-in rows whose session has ended, and rows about records it cannot open. A broad read is served whole. The gate's 2,000-row pre-scan does not run for a holder, so the read is not cut off at that bound.
- **What still applies to the holder.** The holder still needs object-level read on `sys_audit_log`. The field-level redaction still narrows every before/after snapshot it is served. Under a walled tenancy posture, the tenant wall still keeps the holder to its own organization's rows, which is why the capability is declared `org`.
- **What it does not touch.** The activity stream (`sys_activity`) keeps its own parent-record gate for every caller, holders included. A non-holder's ledger reads are unchanged.

**Migration.** None: no metadata, code or configuration change is needed. Platform administrators get the deletion and sign-out trail back with no action. To give an auditor the trail, grant `view_all_audit_log` through `systemPermissions` in a permission set that also grants read on `sys_audit_log`.
