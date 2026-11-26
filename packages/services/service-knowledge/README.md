# @objectstack/service-knowledge

Orchestrator implementing `IKnowledgeService` over pluggable
`IKnowledgeAdapter` backends. Ships zero RAG infrastructure of its own
— that's the job of adapter plugins (`knowledge-memory`,
`knowledge-pgvector`, `knowledge-turso`, …).

It loads the `knowledge_source` metadata items of the environment — a
`*.knowledge-source.ts` file in an app's `knowledgeSources` collection, or an
item saved in Studio or through MCP — builds each source's index, keeps it in
step with the records, reloads a source when its item changes and drops its
index when the item is removed.

```ts
import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import { KnowledgeMemoryPlugin } from '@objectstack/knowledge-memory';

kernel.use(new KnowledgeServicePlugin());
kernel.use(new KnowledgeMemoryPlugin());
```

```ts
// src/ai/task-notes.knowledge-source.ts
export const TaskNotes: KnowledgeSource = {
  name: 'task_notes',
  label: 'Task notes',
  adapter: 'memory',
  source: { kind: 'object', object: 'task', content: ['title', 'notes'] },
};
```

`new KnowledgeServicePlugin({ sources: [TaskNotes] })` and
`registerSource(TaskNotes)` register the same shape from code. A source
registered in code belongs to no package; a name the other door already holds
is refused.

See [Knowledge Protocol](https://objectstack.ai/docs/protocol/knowledge).

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
