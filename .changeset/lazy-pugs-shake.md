---
"@objectstack/spec": minor
---

`ApiEndpoint.target` is now **optional** in the vocabulary (#10338, maintainer ruling
2026-08-23). The key was required on every endpoint but read only for `type: 'flow'`
(executor, OpenAPI enrichment and the publish gate all address an `object_operation`
via `objectParams.object` / `.operation`) — so an `object_operation` author was forced
to write a dead string nothing consumed or cross-checked. Authoring guidance: omit
`target` on `object_operation` endpoints. The publish gate still **requires** `target`
for `type: 'flow'` — a flow endpoint that names no target flow is refused at publish,
and the runtime's structural backstop answers `501 NOT_IMPLEMENTED` for one that
reached the store another way. No migration: this is a pure widening — every previously
valid declaration (all of which carry a string `target`) still parses unchanged.
