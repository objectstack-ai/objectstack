# @objectstack/knowledge-turso

`IKnowledgeAdapter` on [libSQL](https://github.com/tursodatabase/libsql)'s native vectors — the open vector store for local development (`os dev`) and for deployments not on PostgreSQL. It takes the knowledge service's passages, embeds them with the kernel's `embedder` service, stores passages and vectors in a libSQL database of its own, and answers `search()` by an exact cosine scan.

```ts
import { ObjectKernel } from '@objectstack/core';
import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import { KnowledgeTursoPlugin } from '@objectstack/knowledge-turso';

const kernel = new ObjectKernel();
kernel.use(new KnowledgeServicePlugin({
  sources: [{ id: 'task_notes', label: 'Notes', adapter: 'turso',
    source: { kind: 'object', object: 'task', contentFields: ['notes'] }}],
}));
kernel.use(new KnowledgeTursoPlugin()); // .objectstack/data/knowledge.db
```

## Options

| Option | Default | |
|:--|:--|:--|
| `id` | `'turso'` | The adapter id a source names in `adapter`. |
| `url` | `file:` + `<projectRoot>/.objectstack/data/knowledge.db` | A `file:` URL, `:memory:`, or a `libsql://` (Turso) URL. Never the platform's own database file. |
| `authToken` | — | The token of a `libsql://` URL. |
| `client` | — | A libSQL client to use as it is (not configured, not closed by the plugin). |
| `busyTimeoutMs` | `5000` | How long a write waits for another process's lock on a `file:` store. |
| `projectRoot` | `process.cwd()` | The directory the default file is under. |
| `queryPrefix` | `''` | Text put before every query before it is embedded. Passages are embedded as they are. |
| `embedder` | the kernel's `embedder` service | The embedder to call, read at each call. |

## Its own file, never the platform's

The store opens a libSQL file of its own. Two engines writing one SQLite file in one process lose rows (measured: a row lost silently under WAL, a failed commit in delete mode), so a URL that names the platform's database — `objectstack.db`, `dev.db`, `standalone.db`, or the file `OS_DATABASE_URL` names — is refused: the plugin registers, warns, and every call answers `SERVICE_UNAVAILABLE`.

On a file the store sets WAL and a busy timeout: without them a second process writing the same file lost most of its writes in measurement. Within one process every call of the store runs its database work one at a time.

## Tables

- `knowledge_generation` — one row per source and generation: the index fingerprint it was built under, the recipe hash, the vector width, the model, and whether it is active or being built. At most one of each per source (a unique index: one builder per source).
- `knowledge_<source>_g<n>` — the passages of one generation of one source, with an `F32_BLOB(<width>)` vector column sized for that generation.

## Search

An exact scan by cosine distance (`vector_distance_cos`). The organization filter, the record scope (a passage's record, or a metadata value equal to an id as text, a list matching by any element) and the metadata `filter` (JSON equality per key) run in the same `WHERE`, before ranking — libSQL's DiskANN index (`vector_top_k`) ranks first and filters after, so the store creates none. Measured on Linux x64 with 1,536-wide vectors: 1,000 passages take 8.3 MB and a search about 5 ms; 10,000 passages take 82 MB and a search about 50 ms. (With a DiskANN index the same 1,000 vectors grew a file to 329 MB, and the index build took 21.8 s.) For larger sources, use `@objectstack/knowledge-pgvector`.

## Rebuilds

Every source's index is built under one index fingerprint (the embedding model and dimensions, the split, the content list — ADR-0161 K7). A write or a search under another fingerprint is refused `KNOWLEDGE_REBUILD_REQUIRED` (409) and never served from the stored vectors. A complete reindex under a new fingerprint builds a new generation table beside the active one (the old one keeps answering its own fingerprint meanwhile) and switches to it when the reindex completes; the old table is then dropped. A passage whose text is unchanged is not embedded again within a generation.

A table written by this package's earlier releases (`knowledge_<source>`, from the cloud repository) is never served: a search answers "reindex needed", and the table is dropped when the first complete reindex finishes.

## When it cannot run

When the database cannot be opened, or `@libsql/client` has no native build for the platform (there is none for Windows on ARM), the plugin still registers and boot goes on: it warns with the reason, `healthCheck` answers `ok: false`, and every call answers `SERVICE_UNAVAILABLE` (one sentence; the reason travels in the error's `remedy`, for the operator).

## What it stores

Each row holds its passage's text, title and metadata as well as its vector: the text is as sensitive as the record it came from, and it is in every copy of the file.

## Tests

`pnpm test` runs the adapter contract suite of `@objectstack/service-knowledge/testing` on `:memory:` and on a `file:` URL, and the acceptance cases. libSQL runs in the test process: no service, no image.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
