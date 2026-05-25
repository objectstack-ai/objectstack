# @objectstack/plugin-knowledge-ragflow

[RAGFlow](https://github.com/infiniflow/ragflow) `IKnowledgeAdapter` for ObjectStack.

Bridges the [Knowledge Protocol](../../../content/docs/protocol/knowledge.mdx) to a RAGFlow deployment via its HTTP API. RAGFlow handles chunking (DeepDoc), embedding, hybrid retrieval, and reranking; ObjectStack handles metadata-native sources and permission-aware filtering on top of the returned hits.

## Why RAGFlow?

- **Apache 2.0** — no vendor lock-in.
- **Language-agnostic HTTP API** — we don't have to track a Python or Node SDK release cadence.
- **Best-in-class default accuracy** on mixed PDF / table / scanned content (DeepDoc OCR + layout).
- **Doesn't overlap our stack** — no built-in agent/flow runner competing with ours.

## Setup

```ts
import { ObjectKernel } from '@objectstack/core';
import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import { KnowledgeRagflowPlugin } from '@objectstack/plugin-knowledge-ragflow';

const kernel = new ObjectKernel();
kernel.use(new KnowledgeServicePlugin({
  sources: [{
    id: 'product_docs',
    label: 'Product documentation',
    adapter: 'ragflow',
    source: { kind: 'http', urls: ['https://docs.example.com/sitemap.xml'] },
    options: { datasetId: 'rgf_doc_dataset_id' }, // RAGFlow dataset to bind
  }],
}));
kernel.use(new KnowledgeRagflowPlugin({
  endpoint: process.env.RAGFLOW_ENDPOINT!,    // e.g. http://localhost:9380
  apiKey: process.env.RAGFLOW_API_KEY!,
}));
```

## Source binding

Each `KnowledgeSource` must include `options.datasetId` pointing to a pre-created RAGFlow dataset. The adapter doesn't create datasets — operators do that once in the RAGFlow UI, where they pick the chunking method, embedding model, and rerank policy.

## What the adapter does

| Call | RAGFlow endpoint |
|------|------------------|
| `upsert(docs)` | `POST /api/v1/datasets/:id/chunks` (one chunk-set per doc, keyed by doc id) |
| `search(query)` | `POST /api/v1/retrieval` (cross-dataset) |
| `delete(ids)` | `DELETE /api/v1/datasets/:id/chunks` |
| `healthCheck()` | `GET /api/v1/datasets` (auth probe) |

Permission filtering happens in `KnowledgeService` after `search()` returns — it re-checks each hit's `sourceRecordId` via ObjectQL.
