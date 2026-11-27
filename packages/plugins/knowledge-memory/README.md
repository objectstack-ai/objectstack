# @objectstack/knowledge-memory

In-memory `IKnowledgeAdapter` for ObjectStack — chunks documents, embeds with a deterministic hash-based embedder, and answers `search()` via brute-force cosine similarity.

**Purpose**: dev environments, tests, and the reference implementation for the Knowledge Protocol. **Not for production** — there is no persistence, no real semantic understanding, and recall is bounded by simple token overlap.

```ts
import { ObjectKernel } from '@objectstack/core';
import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import { KnowledgeMemoryPlugin } from '@objectstack/knowledge-memory';

const kernel = new ObjectKernel();
kernel.use(new KnowledgeServicePlugin({
  sources: [{ name: 'task_notes', label: 'Notes', adapter: 'memory',
    source: { kind: 'object', object: 'task', content: ['notes'] }}],
}));
kernel.use(new KnowledgeMemoryPlugin());
```

A source is usually a `knowledge_source` metadata item (a `*.knowledge-source.ts`
file in an app, or one authored in Studio) that names this adapter with
`adapter: 'memory'`; the `sources` option above registers one from code.

When a source stops being served (its item was removed, or a package now holds
its name), the knowledge service calls the adapter's `dropSource` and
everything held for that source is discarded.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
