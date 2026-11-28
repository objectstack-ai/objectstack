# @objectstack/knowledge-turso

`IKnowledgeAdapter` on [libSQL](https://github.com/tursodatabase/libsql)'s native vectors — the open vector store for local development (`os dev`) and for deployments not on PostgreSQL. It takes the knowledge service's passages, embeds them with the kernel's `embedder` service, stores passages and vectors in a libSQL database of its own, and answers `search()` with two legs — a cosine ranking (an exact scan, or an approximate index for a large source of one organization) and a keyword match — merged by reciprocal rank fusion.

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
| `vectorIndexThreshold` | `20000` | The passage count at or above which a complete build makes a source's approximate vector index ([Search](#search)). `Infinity` never makes one. |
| `vectorIndexOverfetch` | `40` | How many approximate-index candidates the vector leg reads per hit, before the filter runs. A whole number, 8 or more. |

## Its own file, never the platform's

The store opens a libSQL file of its own. Two engines writing one SQLite file in one process lose rows (measured: a row lost silently under WAL, a failed commit in delete mode), so a URL that names the platform's database — `objectstack.db`, `dev.db`, `standalone.db`, or the file `OS_DATABASE_URL` names, compared as the file a link resolves to and with SQLite's `-wal`, `-shm` and `-journal` side files read as their database — is refused: the plugin registers, warns, and every call answers `SERVICE_UNAVAILABLE`.

On a file the store sets WAL and a busy timeout: without them a second process writing the same file lost most of its writes in measurement. Within one process every call of the store runs its database work one at a time.

## Tables

- `knowledge_generation` — one row per source and generation: the index fingerprint it was built under, the recipe hash, the vector width, the model, and whether it is active or being built. At most one of each per source, by a unique index. It does not refuse a second builder: a second build under the same fingerprint joins the one under way, and one under another fingerprint replaces it, after which the first build's writes, listing and completion are refused `LOCK_CONFLICT` (409) and that build ends; a write outside a build under the replaced fingerprint is refused `KNOWLEDGE_REBUILD_REQUIRED`. No generation mixes two fingerprints.
- `knowledge_<source>_g<n>` — the passages of one generation of one source, with an `F32_BLOB(<width>)` vector column sized for that generation.
- `knowledge_<source>_g<n>-vec`, `…-org` — a large source's approximate vector index ([Search](#search)), when it has one: a side table of the passages' vectors quantized to one bit a dimension (`F1BIT_BLOB`, 192 bytes at 1,536 dimensions), an index of the passage table's organization column, and three triggers that keep the side table in step with every write. Dropped with the passage table, by a generation switch and by `dropSource`; an object under one of those names that the store did not make is never dropped or used, and the call is refused `SERVICE_UNAVAILABLE`, naming it.

`<source>` is the source's index key: its name, or for a source a package ships, the knowledge service's spelling of that package and name (so two packages' sources of one name are two tables). When a source stops being served (its metadata item was removed, or a package now holds its name), the knowledge service calls `dropSource`: the source's generation tables and rows are dropped in one transaction. A table the store did not make under one of those names (an object's table, in a database shared with object tables) is never dropped: the call is refused `SERVICE_UNAVAILABLE`, naming the table, and nothing of the source is removed. A build of the source under way when it is dropped, in this process or another, is ended: its next write, listing or completion is refused `LOCK_CONFLICT` (409) and opens nothing, so the build never brings the source back. A build that begins after the drop builds the source from nothing.

## Search

Two legs, merged by reciprocal rank fusion (RRF, `k` = 60) before the knowledge service re-checks each hit as the caller. Each leg ranks at most `topK` passages; a hit's `score` is the sum of `1 / (60 + rank)` over the legs that rank it, divided by that of a passage first in both, so it lies in `(0, 1]`: 1 for first in both legs, 0.5 for first in one alone.

- **Keyword leg.** The query is split into terms at white space and punctuation; a hyphen, dot, slash, underscore, `#`, `@` or `+` inside a term keeps it whole, so `X-200` and `v1.2` are one term each (at most 16 terms). A term of three characters or more is matched as one quoted FTS5 phrase in the passage table's trigram index — so `X-200` is text, never FTS5 syntax, and 「住宿标准」 matches inside 「员工出差住宿标准」. A shorter term, which a trigram index cannot match (「出差」), is matched by `content LIKE '%…%'` over the rows in scope. A passage's keyword score sums, over the terms it holds, the term's BM25 inverse document frequency among the rows in scope, so a word most passages hold weighs little. There is no word segmentation: a Chinese question is one term unless it holds spaces or punctuation, so the keyword leg finds a code, a name or a phrase as written, and the vector leg answers the question's meaning.
- **Keyword index.** Each passage table `knowledge_<source>_g<n>` has one beside it: a map table `…-kw`, a contentless FTS5 table `…-fts` (`tokenize='trigram'`) and three triggers that keep both in step with every insert, rewrite and removal of a passage, inside the statement that writes it. It is made with the table and dropped with it. A table made by a release without one gets it at its first search, built from the rows it holds in one transaction; until then nothing else changes. Its names hold a hyphen, which no source, generation or object name can, and an object under one of them that the store did not make is never dropped or used: the generation is refused `SERVICE_UNAVAILABLE`, naming it.
- **Vector leg.** Passages ranked by the cosine distance of their stored vector (`vector_distance_cos`); a passage whose cosine similarity is not positive is not ranked by it. Its ranks 1…`topK` feed the fusion, whichever of the two ways below found the passages.

The organization filter, the record scope (a passage's record, or a metadata value equal to an id as text, a list matching by any element) and the metadata `filter` (JSON equality per key) are one `WHERE`, run in both legs.

- **Exact scan.** The vector leg reads every row in scope. Measured on Linux x64 with 1,536-wide vectors: 1,000 passages take 8.3 MB and a search about 5 ms; 10,000 passages take 82 MB and a search about 50 ms.
- **Approximate index, for a large source.** When a complete build of a source completes (`os knowledge rebuild`, a fingerprint change, the boot build or the daily reconcile — they all end in `completeBuild`) on a generation of `vectorIndexThreshold` passages or more (default 20,000), the store makes that generation's approximate index: every passage's vector quantized to one bit a dimension, in a side table a 32nd the size of the vectors. The vector leg then ranks the side table by its one-bit vectors, takes the nearest `topK × vectorIndexOverfetch` (default 40 a hit) as candidates, runs the same `WHERE` over them, and ranks those in scope by their stored float32 vector. The candidates are ranked before the filter, so a leg the filter leaves with fewer than 8 × `topK` candidates in scope, or short of `topK` hits, is run again as the exact scan. The float32 re-rank of a thin pool misses the neighbours the one-bit ranking put past the cut: measured at 200,000 passages, a pool of `topK` gave a recall@10 of 0.88 with 3% of the passages in scope, and a pool of 4 × `topK` still left a query at 0.7 with 10% in scope. So a search whose scope keeps a small share of a source's passages is answered by the exact scan, and the index speeds up the broad ones. And a search never answers fewer hits than the exact scan would, since the knowledge service reads "fewer than asked" as "no more there".
- **Measured** on Linux x64 at 200,000 passages of 1,536 dimensions (clustered synthetic vectors, one organization, `topK` 10, on a shared machine): a search whose keyword leg matches nothing took 66 ms at the median and 81 ms at p95 (the exact scan: 958 ms and 1,054 ms), with a recall@10 against the exact scan of 0.998 over 100 queries; a hybrid search took 550 ms and 666 ms (exact: 1,416 ms and 1,544 ms), recall@10 1.000 — the keyword leg, unchanged, is most of that, and a term under three characters (`LIKE` over every row in scope) alone costs about 600 ms there.
- **When it is built.** At the end of a complete build, never on a search: the side table is made empty in one transaction, then the passage table's rows are copied in, 2,048 to a transaction, before the generation is switched to (or, for a build inside the active generation, while it keeps answering by the exact scan); 200,000 passages took 3 s and 54 MB. Every write after that also writes the passage's one-bit vector. A source that grows past the threshold between builds keeps the exact scan until its next complete build — at the latest the next daily reconcile. A database that refuses the one-bit vectors or the index's DDL (a host whose libSQL lacks them) gets no index: the build completes, the source keeps the exact scan, and the adapter's health check (the plugin's boot line, the knowledge health endpoint) names the source and the reason until a later build makes the index.
- **Never over two organizations.** The candidates are ranked over every passage of the table, so over two organizations' passages the candidates for one could all be the other's. So a generation whose passages belong to more than one organization (passages of none count as one more) gets no index, and every search reads the organization index (its least and greatest value, and whether a passage has none) and takes the exact scan as soon as a second organization's passage is written. It is decided on the source's passage table, the one the candidates are ranked over, not on the whole database; a hosted database holds one organization (cloud ADR-0114).
- **Not libSQL's DiskANN index (`vector_top_k`).** Measured on the same 200,000 passages, it took 24 minutes and 2.2 GB to build (one-bit neighbours, at most 32 each; libSQL's defaults took 329 MB and 21.8 s for 1,000 vectors), and its recall@10 against the exact scan was 0.39 — no larger `k` raised it past 0.46; at 20,000 passages no setting tried passed 0.85.

For a source of hundreds of thousands of passages shared by many organizations, use `@objectstack/knowledge-pgvector`.

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
