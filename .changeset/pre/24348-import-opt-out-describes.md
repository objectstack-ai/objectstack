---
'@objectstack/spec': patch
---

Clause-②: no

The `runAutomations` and `treatAsHistorical` describes on `ImportRequestSchema` (and so `CreateImportJobRequestSchema`, the same schema) now say who may send the opt-out: only the system principal, an in-process caller such as a seed or migration job. The import doors refuse `runAutomations: false` and `treatAsHistorical: true` from every other caller, every signed-in user and administrator included, with `403 PERMISSION_DENIED` before any row is read. The `runAutomations` describe no longer tells a caller that it gets a silent bulk load by sending `false`, and the schema's example body no longer sends it. The schema shape and both defaults are unchanged.
