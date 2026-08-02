---
"@objectstack/spec": major
---

feat(spec)!: retire `datasource.healthCheck` — no probe loop ever existed (#4583 batch C)

Three keys — `enabled`, `intervalMs`, `timeoutMs` — declared, strict-guarded, read by
nothing. No health-check loop was ever scheduled, so `enabled: true` enabled nothing and
the two timeouts bounded nothing.

Connection liveness is probed **on demand** through the driver handle's `ping()` /
`checkHealth()`, which the datasource admin service calls for "Test connection". That is
the mechanism — it needs no configuration here and never read this block.

Note what it is NOT to be confused with: `external.validation.checkIntervalMs` is the one
recurring datasource timer, and it checks **schema drift** on a federated datasource, not
connection liveness. It is unaffected.

FROM → TO: delete the block. `os migrate meta --from 16` removes it automatically
(conversion `datasource-inert-blocks-removed`).
