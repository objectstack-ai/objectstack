---
"@objectstack/knowledge-ragflow": patch
---

The RAGFlow adapter now reads the declared key: a source's RAGFlow binding comes from `adapterConfig.datasetId`, not `options.datasetId`.

`KnowledgeSourceSchema` declares `adapterConfig` for adapter-specific configuration and is a plain `z.object` — it carries no `.passthrough()`, so any path that parses a source drops `options` before an adapter ever sees it. The adapter read `options` through a cast, which worked only because no path parses a source today. The cast is gone; there is no fallback that also reads `options` (Prime Directive #12 — one strict contract, no lenient consumer).

Migration, `FROM` → `TO`, one line per source:

```ts
// FROM
{ id: 'product_docs', adapter: 'ragflow', options: { datasetId: 'rgf_…' } }
// TO
{ id: 'product_docs', adapter: 'ragflow', adapterConfig: { datasetId: 'rgf_…' } }
```

The same move applies to `rerankModel`, `similarityThreshold` and `vectorSimilarityWeight`, which the adapter reads from the same bag. A source left on the old spelling is refused by name — `RAGFlow adapter requires source.adapterConfig.datasetId on source '<id>'` — rather than silently retrieving nothing, so the upgrade is self-describing at the first call. Nothing an author could declare is removed: `options` was never a key `KnowledgeSourceSchema` accepted, which is why this carries no ADR-0087 conversion.

The package's published `README.md` moves with the adapter and now compiles against it — it was the one block of the 44 that #18915 could not repair, because correcting the spelling alone would have compiled and stopped working.

Clause-②: no
