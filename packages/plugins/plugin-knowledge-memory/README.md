# @objectstack/plugin-knowledge-memory

In-memory `IKnowledgeAdapter` for ObjectStack — chunks documents, embeds with a deterministic hash-based embedder, and answers `search()` via brute-force cosine similarity.

**Purpose**: dev environments, tests, and the reference implementation for the Knowledge Protocol. **Not for production** — there is no persistence, no real semantic understanding, and recall is bounded by simple token overlap.

```ts
import { ObjectKernel } from '@objectstack/core';
import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import { KnowledgeMemoryPlugin } from '@objectstack/plugin-knowledge-memory';

const kernel = new ObjectKernel();
kernel.use(new KnowledgeServicePlugin({
  sources: [{ id: 'task_notes', label: 'Notes', adapter: 'memory',
    source: { kind: 'object', object: 'task', contentFields: ['notes'] }}],
}));
kernel.use(new KnowledgeMemoryPlugin());
```
