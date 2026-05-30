---
"@objectstack/service-ai": minor
---

External Datasource Federation (ADR-0015) — Phase 4: AI awareness.

`SchemaRetriever.renderSnippet` now annotates federated objects in the
auto-injected schema context, e.g.
`### wh_order — Warehouse Order [external, read-only, datasource=warehouse]`,
so the LLM knows an object comes from a customer's production database and must
not propose schema changes or unsafe writes. `ObjectShape` gains `datasource`
+ `external` (read from object metadata). Managed objects are unannotated.
