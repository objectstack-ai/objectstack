---
"@objectstack/spec": patch
---

Register `FLOW_CONVERSION_CONFLICT` (409) in the ADR-0112 error-code ledger under
`@objectstack/metadata-protocol` (#9567). The code was already live on the wire —
`saveMetaItem`'s flow-conversion rename guard (`protocol.ts`) has thrown it since
ADR-0078 landed, already SCREAMING_SNAKE — but was invisible to
`check:dispatcher-error-vocabulary`'s scan because the site stamps it through a
cast (`(err as any).code = 'FLOW_CONVERSION_CONFLICT'`) rather than the bare-
identifier `assign` shape the scan matched at the time. This is an ordinary,
additive admission: no accept/reject behavior, no producer, and no wire shape
changes.
