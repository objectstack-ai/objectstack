# @objectstack/service-knowledge

Orchestrator implementing `IKnowledgeService` over pluggable
`IKnowledgeAdapter` backends. Ships zero RAG infrastructure of its own
— that's the job of adapter plugins (`knowledge-memory`,
`knowledge-ragflow`, …).

See [Knowledge Protocol](https://docs.objectstack.ai/docs/protocol/knowledge).

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
