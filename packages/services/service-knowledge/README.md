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
`QueueServicePlugin` over the ObjectQL engine, which the standard runtime mounts
on every preset but `minimal`; with only the kernel's in-memory fallback the sync runs inline, as the
boot says once at `warn`. A host that mounts the service by hand adds:

```ts
import { QueueServicePlugin } from '@objectstack/service-queue';

kernel.use(new QueueServicePlugin());
```

Each source keeps one sync-state row in `sys_knowledge_sync_state`, which the
plugin registers with its manifest: the last build (who started it, how it
ended, its times and counts, one sentence) and the record syncs that failed
and are not yet repaired (how many, the first and last time, one sentence
naming the record and the kind of error, never a field value). Every node
reads and writes the same row, so `index_status`, `os knowledge status` and
Setup → Knowledge Sync Status answer the same whichever node is asked, and a
restart forgets nothing. A build a stopped node left `running` is closed
`interrupted` by the next boot or the next node that takes the source's build
lease. A completed reconcile clears the failures recorded before its walk and
removes their dead letters; the first failure of a source asks for a
reconcile two minutes later. The row goes when the source is removed. Only the
service writes it, and only a platform administrator
(`manage_platform_settings`) reads it.

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
