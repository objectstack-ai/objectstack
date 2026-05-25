# @objectstack/service-knowledge

Orchestrator implementing `IKnowledgeService` over pluggable
`IKnowledgeAdapter` backends. Ships zero RAG infrastructure of its own
— that's the job of adapter plugins (`plugin-knowledge-memory`,
`plugin-knowledge-ragflow`, …).

See [`content/docs/protocol/knowledge.mdx`](../../../content/docs/protocol/knowledge.mdx).
