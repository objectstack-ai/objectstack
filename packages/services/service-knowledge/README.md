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

Record events keep an index fresh; a reconcile keeps it correct. Once a day
(03:00 UTC, on the platform's job service) and two minutes after a predicate
write (`multi: true`), the service walks every source whose store lists its
documents: it writes what is new or changed, purges what is gone or no longer
matches `where`, and embeds nothing that did not change.
`new KnowledgeServicePlugin({ reconcile: { cron, timezone } })` moves the
daily run and `reconcile: false` turns it off.

A record change reaches the index through the queue service. The save
publishes one message per source to the `knowledge-record-sync` queue (the
source, the object, the record id — never a field value) once its unit of work
commits, and nothing for a write that rolls back; a worker re-reads the row and
writes or removes its document. The save does not wait for the embedder. A
failed sync is retried (`recordSyncRetry`, eight attempts over about six and a
half minutes by default), then kept as a dead letter (`listFailed`) that the
reconcile repairs. This needs a durable `queue` service — the platform's
`QueueServicePlugin` over the ObjectQL engine, which the standard runtime always
mounts; with only the kernel's in-memory fallback the sync runs inline, as the
boot says once at `warn`. A host that mounts the service by hand adds:

```ts
import { QueueServicePlugin } from '@objectstack/service-queue';

kernel.use(new QueueServicePlugin());
```

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
