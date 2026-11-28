# @objectstack/knowledge-turso

`IKnowledgeAdapter` on [libSQL](https://github.com/tursodatabase/libsql)'s native vectors — the open vector store for local development (`os dev`) and for deployments not on PostgreSQL. It takes the knowledge service's passages, embeds them with the kernel's `embedder` service, stores passages and vectors in a libSQL database of its own, and answers `search()` with two legs — an exact cosine scan and a keyword match — merged by reciprocal rank fusion.

```ts
import { ObjectKernel } from '@objectstack/core';
import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
import { KnowledgeTursoPlugin } from '@objectstack/knowledge-turso';

const kernel = new ObjectKernel();
kernel.use(new KnowledgeServicePlugin({
  sources: [{ name: 'task_notes', label: 'Notes', adapter: 'turso',
    source: { kind: 'object', object: 'task', content: ['notes'] }}],
}));
kernel.use(new KnowledgeTursoPlugin()); // .objectstack/data/knowledge.db
```

A source is usually a `knowledge_source` metadata item (a `*.knowledge-source.ts` file in an app, or one authored in Studio) that names this adapter with `adapter: 'turso'`; the `sources` option above registers one from code.

## Options

| Option | Default | |
|:--|:--|:--|
| `id` | `'turso'` | The adapter id a source names in `adapter`. |
| `url` | `file:` + `<projectRoot>/.objectstack/data/knowledge.db` | A `file:` URL, `:memory:`, or a `libsql://` (Turso) URL. Never the platform's own database file. |
| `authToken` | — | The token of a `libsql://` URL. |
| `client` | — | A libSQL client to use as it is (not configured, not closed by the plugin). |
| `busyTimeoutMs` | `5000` | How long a write waits for another process's lock on a `file:` store. |
| `requestTimeoutMs` | `10000` for a remote URL | The longest one request to a remote database may take (each statement, each document's batch of a write, each commit) before the call answers `SERVICE_UNAVAILABLE`. A write stopped before its commit is rolled back, never committed. None for a file or `:memory:`; for a `client` given as it is, only when set. |
| `projectRoot` | `process.cwd()` | The directory the default file is under. |
| `queryPrefix` | `''` | Text put before every query before it is embedded. Passages are embedded as they are. |
| `embedder` | the kernel's `embedder` service | The embedder to call, read at each call. |

## Its own file, never the platform's

The store opens a libSQL file of its own. Two engines writing one SQLite file in one process lose rows (measured: a row lost silently under WAL, a failed commit in delete mode), so a URL that names the platform's database — `objectstack.db`, `dev.db`, `standalone.db`, or the file `OS_DATABASE_URL` names, compared as the file a link resolves to and with SQLite's `-wal`, `-shm` and `-journal` side files read as their database — is refused: the plugin registers, warns, and every call answers `SERVICE_UNAVAILABLE`.

On a file the store sets WAL and a busy timeout: without them a second process writing the same file lost most of its writes in measurement. Within one process every call of the store runs its database work one at a time.

## Tables

- `knowledge_generation` — one row per source and generation: the index fingerprint it was built under, the recipe hash, the vector width, the model, and whether it is active or being built. At most one of each per source, by a unique index. It does not refuse a second builder: a second build under the same fingerprint joins the one under way, and one under another fingerprint replaces it, after which the first build's writes, listing and completion are refused `LOCK_CONFLICT` (409) and that build ends; a write outside a build under the replaced fingerprint is refused `KNOWLEDGE_REBUILD_REQUIRED`. No generation mixes two fingerprints.
- `knowledge_<source>_g<n>` — the passages of one generation of one source, with an `F32_BLOB(<width>)` vector column sized for that generation.

`<source>` is the source's index key: its name, or for a source a package ships, the knowledge service's spelling of that package and name (so two packages' sources of one name are two tables). When a source stops being served (its metadata item was removed, or a package now holds its name), the knowledge service calls `dropSource`: the source's generation tables and rows are dropped in one transaction. A table the store did not make under one of those names (an object's table, in a database shared with object tables) is never dropped: the call is refused `SERVICE_UNAVAILABLE`, naming the table, and nothing of the source is removed. A build of the source under way when it is dropped, in this process or another, is ended: its next write, listing or completion is refused `LOCK_CONFLICT` (409) and opens nothing, so the build never brings the source back. A build that begins after the drop builds the source from nothing.

## Search

Two legs, merged by reciprocal rank fusion (RRF, `k` = 60) before the knowledge service re-checks each hit as the caller. Each leg ranks at most `topK` passages; a hit's `score` is the sum of `1 / (60 + rank)` over the legs that rank it, divided by that of a passage first in both, so it lies in `(0, 1]`: 1 for first in both legs, 0.5 for first in one alone.

- **Keyword leg.** The query is split into terms at white space and punctuation; a hyphen, dot, slash, underscore, `#`, `@` or `+` inside a term keeps it whole, so `X-200` and `v1.2` are one term each (at most 16 terms). A term of three characters or more is matched as one quoted FTS5 phrase in the passage table's trigram index — so `X-200` is text, never FTS5 syntax, and 「住宿标准」 matches inside 「员工出差住宿标准」. A shorter term, which a trigram index cannot match (「出差」), is matched by `content LIKE '%…%'` over the rows in scope. A passage's keyword score sums, over the terms it holds, the term's BM25 inverse document frequency among the rows in scope, so a word most passages hold weighs little. There is no word segmentation: a Chinese question is one term unless it holds spaces or punctuation, so the keyword leg finds a code, a name or a phrase as written, and the vector leg answers the question's meaning.
- **Keyword index.** Each passage table `knowledge_<source>_g<n>` has one beside it: a map table `…-kw`, a contentless FTS5 table `…-fts` (`tokenize='trigram'`) and three triggers that keep both in step with every insert, rewrite and removal of a passage, inside the statement that writes it. It is made with the table and dropped with it. A table made by a release without one gets it at its first search, built from the rows it holds in one transaction; until then nothing else changes. Its names hold a hyphen, which no source, generation or object name can, and an object under one of them that the store did not make is never dropped or used: the generation is refused `SERVICE_UNAVAILABLE`, naming it.
- **Vector leg.** An exact scan by cosine distance (`vector_distance_cos`); a passage whose cosine similarity is not positive is not ranked by it.

The organization filter, the record scope (a passage's record, or a metadata value equal to an id as text, a list matching by any element) and the metadata `filter` (JSON equality per key) are one `WHERE`, run in both legs before either ranks — libSQL's DiskANN index (`vector_top_k`) ranks first and filters after, so the store creates none. Measured on Linux x64 with 1,536-wide vectors: 1,000 passages take 8.3 MB and a search about 5 ms; 10,000 passages take 82 MB and a search about 50 ms. (With a DiskANN index the same 1,000 vectors grew a file to 329 MB, and the index build took 21.8 s.) For larger sources, use `@objectstack/knowledge-pgvector`.

## Rebuilds

Every source's index is built under one index fingerprint (the embedding model and dimensions, the split, the content list — ADR-0161 K7). A write or a search under another fingerprint is refused `KNOWLEDGE_REBUILD_REQUIRED` (409) and never served from the stored vectors. A complete reindex under a new fingerprint builds a new generation table beside the active one (the old one keeps answering its own fingerprint meanwhile) and switches to it when the reindex completes; the old table is then dropped. A passage whose text is unchanged is not embedded again within a generation.

A table written by this package's earlier releases (`knowledge_<source>`, from the cloud repository) is never served: a search answers "reindex needed", and the table is dropped when the first complete reindex finishes. It is recognised by its exact columns: a table of any other shape under a store's table name, one the store did not make in a shared database, is never served and never dropped: a rebuild that would replace it, like a `dropSource`, is refused `SERVICE_UNAVAILABLE`, naming the table.

## When it cannot run

When the database cannot be opened, or `@libsql/client` has no native build for the platform (there is none for Windows on ARM), the plugin still registers and boot goes on: it warns with the reason, `healthCheck` answers `ok: false`, and every call answers `SERVICE_UNAVAILABLE` (one sentence; the reason travels in the error's `remedy`, for the operator). So does a database holding a table named `knowledge_generation` that is not the store's (its columns are not the generation table's): the store is not ready, the reason names that table, and the table is left as it is.

## What it stores

Each row holds its passage's text, title and metadata as well as its vector: the text is as sensitive as the record it came from, and it is in every copy of the file.

## Tests

`pnpm test` runs the adapter contract suite of `@objectstack/service-knowledge/testing` on `:memory:` and on a `file:` URL, and the acceptance cases. libSQL runs in the test process: no service, no image.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
