---
'@objectstack/spec': patch
---

docs(liveness): record the tenancy.strategy / crossTenantAccess removal decision (#2763)

Owner decision 2026-07-10: the platform has exactly two multi-tenancy
modes — per-tenant database (environment-level, zero object config) and
shared-DB organization row isolation (`tenancy.enabled` + `tenantField`).
Object-level isolation strategy has no requirement, so `strategy` and
`crossTenantAccess` are slated for removal at the next spec major.
Ledger notes + compile-time authorHints now state the decision and point
authors at the two real mechanisms.
