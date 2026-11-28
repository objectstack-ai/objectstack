---
'@objectstack/service-knowledge': patch
---

feat(service-knowledge): `embedderSettings: false` keeps the embedder section off the ai settings page

Clause-②: yes
Metadata-protocol: none

`KnowledgeServicePluginOptions` gains `embedderSettings` (default `true`). A host that provides the embedder itself (it registers the `embedder` service, which the plugin keeps) sets it to `false`: the `ai` settings page then carries no `embedder_*` fields, `ai/test_embedder` has no handler and answers like any undeclared action, and the boot warning about the embedder settings not being offered is not logged. The knowledge settings page, its actions and its Setup entry are unchanged. `contributeKnowledgeSettings` takes the same switch as an optional fourth argument (`KnowledgeSettingsContributionOptions`). Omitted or `true`, nothing changes. Nothing to migrate.
