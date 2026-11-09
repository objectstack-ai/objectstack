---
'@objectstack/service-datasource': patch
---

fix(service-datasource): Test connection answers `ok: false` when the driver connects but its own health check answers `false` (#30407)

Clause-②: no — a served answer comes to match the driver's own health answer; no accept set changes.
Metadata-protocol: none

The datasource probe awaited the handle's `ping` (the driver's `checkHealth()`) and dropped its boolean, so a connect that only warned and then reported itself unhealthy answered Test connection `ok: true`. The probe now reads that answer: a literal `false` answers `ok: false` with a sentence saying the driver connected but its health check reported the database as unhealthy. A connect or ping that throws keeps answering the thrown message, and a handle whose `ping` answers nothing keeps answering `ok: true`.
