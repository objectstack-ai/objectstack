# @objectstack/knowledge-pgvector

`IKnowledgeAdapter` on PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension — the open vector store for self-hosted ObjectStack deployments. It takes the knowledge service's passages, embeds them with the kernel's `embedder` service, stores passages and vectors in PostgreSQL, and answers `search()` by an exact cosine scan.

```ts
import { ObjectKernel } from '@objectstack/core';
import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import { KnowledgePgvectorPlugin } from '@objectstack/knowledge-pgvector';

const kernel = new ObjectKernel();
kernel.use(new KnowledgeServicePlugin({
  sources: [{ name: 'task_notes', label: 'Notes', adapter: 'pgvector',
    source: { kind: 'object', object: 'task', content: ['notes'] }}],
}));
kernel.use(new KnowledgePgvectorPlugin());
```

A source is usually a `knowledge_source` metadata item (a `*.knowledge-source.ts` file in an app, or one authored in Studio) that names this adapter with `adapter: 'pgvector'`; the `sources` option above registers one from code.

## Options

| Option | Default | |
|:--|:--|:--|
| `id` | `'pgvector'` | The adapter id a source names in `adapter`. |
| `url` | the platform database | A `postgres://` URL. Absent: `OS_DATABASE_URL` (else the legacy `DATABASE_URL`) when it is PostgreSQL. |
| `schema` | `'os_knowledge'` | The schema the store's tables live in. |
| `poolMax` | `4` | Connections in the store's own pool. |
| `connectTimeoutMs` | `5000` | How long a new connection may take before it fails; boot waits on the store's first check. |
| `queryPrefix` | `''` | Text put before every query before it is embedded (BGE's `'Represent this sentence for searching relevant passages: '`). Passages are embedded as they are. |
| `embedder` | the kernel's `embedder` service | The embedder to call. |

## Which database, and where

The store is in ONE database: the `url` given, else the platform's when that is PostgreSQL. Where organizations have databases of their own, the store is still that one database; organizations are kept apart by the `organization_id` column, which every search filters on in SQL before ranking.

Its tables are in their own schema, `os_knowledge` — never the connection's own schema, where object tables live and which the platform's schema-drift checks read:

- `knowledge_generation` — one row per source and generation: the index fingerprint it was built under, the recipe hash, the vector width, the model.
- `knowledge_vec_d<width>` — one passage table per vector width (`knowledge_vec_d1536`, `knowledge_vec_d3072`, …), created the first time a width is written.

Rows are keyed by the source's index key: its name, or for a source a package ships, the knowledge service's spelling of that package and name (so two packages' sources of one name are two indexes). Two deployments that share one database — staging and production, say — must each set their own `schema`, or a source name they both use would be one index.

When a source stops being served (its metadata item was removed, or a package now holds its name), the knowledge service calls `dropSource`: every generation of the source is retired in one transaction, so nothing searches or writes it from then on, and its passages are then deleted in batches, the generation rows last.

## Setup when the connection may not create them

On boot the plugin creates the `vector` extension (if it is missing and the connection may), the schema and the generation table. When it cannot, the plugin still registers and boot goes on: it warns with the SQL to run, its `healthCheck` answers `ok: false` with that SQL, and every call answers `SERVICE_UNAVAILABLE` (one sentence; the SQL and the driver's text go only to the health check, the boot warning and the log) until a database owner has run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS "os_knowledge";
-- and the generation table, as the warning prints it
```

The next call retries; no restart is needed. A database the plugin cannot reach is reported as unreachable, with the driver's error and no SQL.

## An approximate index is an operator's step

The store creates no approximate index: every search is an exact scan, which is right for small and medium sources and works at any width. When a table outgrows it, add an index by hand:

```sql
CREATE INDEX ON os_knowledge.knowledge_vec_d1536 USING hnsw (embedding vector_cosine_ops);
```

pgvector's HNSW index takes at most 2,000 dimensions (`vector` type); a 3072-wide table stays on the exact scan.

## Rebuilds

Every source's index is built under one index fingerprint (the embedding model and dimensions, the split, the content list — ADR-0161 K7). A write or a search under another fingerprint is refused `KNOWLEDGE_REBUILD_REQUIRED` (409) and never served from the stored vectors.

When the fingerprint changes, a complete reindex builds a **new generation** beside the active one; nothing has to be cleared by hand:

- The reindex writes into the new generation, and so do the event-sync writes that arrive while it runs: they carry the new fingerprint. Nothing is written into the active generation under the new one.
- A search of the source during the build is refused `KNOWLEDGE_REBUILD_REQUIRED`, saying the source is being rebuilt. It is never answered from the old generation.
- When the walk and its purge are done, the new generation becomes the active one and the old one is retired, in one transaction. The old one's passages are then deleted in batches of 1,000 rows (`deleteBatchSize` on the adapter), and its generation row last. A deletion that stops part-way is finished by the source's next build; a retired generation is never searched.
- One builder per source: a build holds a PostgreSQL advisory lock on the source, on a connection of its own, from its start to the switch. A second build from another process is refused `LOCK_CONFLICT` (409). The lock is freed when the build completes, when the process or its connection dies, or after 15 minutes without a call of the build itself (`buildLockIdleMs`; record events that arrive meanwhile do not count).
- **The lock needs a direct or session-mode connection.** It is a PostgreSQL *session* advisory lock. Behind a connection pooler in transaction mode (PgBouncer's transaction pooling, or the pooled URL some hosted PostgreSQL services give you), the lock is not held by the store's session, so it can stay held with no build running, or fail to keep a second builder out. Give the store a direct URL or a session-mode one (the `url` option, else `OS_DATABASE_URL`). When the build ends and its session no longer holds the lock, the plugin logs a warning that says so.
- A build that stops is resumed: the next build under the same fingerprint takes up the generation under construction with what it holds, and skips every document it already holds unchanged. A build under yet another fingerprint abandons it and deletes it.

A generation never takes over passage rows left without a generation row (a generation row deleted by hand, its passages not): they are deleted before any generation opens, so old vectors cannot be carried into a new index.

A passage whose text is unchanged is not embedded again on a reindex.

## What it stores

Each row holds its passage's text, title and metadata as well as its vector: the text is as sensitive as the record it came from, and it is in every backup of the database.

## Tests

`pnpm test` runs the unit cases everywhere. The contract suite and the acceptance cases run against a live PostgreSQL with pgvector when `OS_TEST_POSTGRES_URL` is set (CI: the `Temporal Conformance` job's `pgvector/pgvector` service), each in a schema of its own.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
