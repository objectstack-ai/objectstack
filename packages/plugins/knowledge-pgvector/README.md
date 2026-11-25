# @objectstack/knowledge-pgvector

`IKnowledgeAdapter` on PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension — the open vector store for self-hosted ObjectStack deployments. It takes the knowledge service's passages, embeds them with the kernel's `embedder` service, stores passages and vectors in PostgreSQL, and answers `search()` by an exact cosine scan.

```ts
import { ObjectKernel } from '@objectstack/core';
import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import { KnowledgePgvectorPlugin } from '@objectstack/knowledge-pgvector';

const kernel = new ObjectKernel();
kernel.use(new KnowledgeServicePlugin({
  sources: [{ id: 'task_notes', label: 'Notes', adapter: 'pgvector',
    source: { kind: 'object', object: 'task', contentFields: ['notes'] }}],
}));
kernel.use(new KnowledgePgvectorPlugin());
```

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

Rows are keyed by source id. Two deployments that share one database — staging and production, say — must each set their own `schema`, or a source id they both use would be one index.

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

Every source's index is built under one index fingerprint (the embedding model and dimensions, the split, the content list — ADR-0161 K7). A write or a search under another fingerprint is refused `KNOWLEDGE_REBUILD_REQUIRED` (409) and never served from the stored vectors. This store does not yet build a second generation beside the first: when the fingerprint changes, a complete reindex is refused, and its result carries the exact statements that clear the source — one `DELETE` per passage table, then the generation row. Run them as printed, and reindex. A first generation never takes over passage rows left without a generation row: they are deleted when it opens, so deleting only the generation row cannot carry old vectors into the new index.

A passage whose text is unchanged is not embedded again on a reindex.

## What it stores

Each row holds its passage's text, title and metadata as well as its vector: the text is as sensitive as the record it came from, and it is in every backup of the database.

## Tests

`pnpm test` runs the unit cases everywhere. The contract suite and the acceptance cases run against a live PostgreSQL with pgvector when `OS_TEST_POSTGRES_URL` is set (CI: the `Temporal Conformance` job's `pgvector/pgvector` service), each in a schema of its own.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
