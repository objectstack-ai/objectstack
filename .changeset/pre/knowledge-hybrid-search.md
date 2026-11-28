---
'@objectstack/knowledge-turso': patch
'@objectstack/knowledge-pgvector': patch
---

feat(knowledge-turso, knowledge-pgvector): hybrid search — a keyword leg merged with the vector leg by reciprocal rank fusion

Clause-②: no
Metadata-protocol: none

A vector alone often ranks a passage that names an exact token — an order number, a model code like `X-200`, a person's name, a short term like 「出差」 — below `topK`. Both open stores now search with two legs and merge them by reciprocal rank fusion (`k` = 60, each leg at most `topK`) before the knowledge service re-checks each hit as the caller. The organization filter, the record scope and the metadata `filter` are one `WHERE`, run in both legs before either ranks.

- **Terms.** The query is split at white space and punctuation; a hyphen, dot, slash, underscore, `#`, `@` or `+` inside a term keeps it whole (at most 16 terms). A passage's keyword score sums the BM25 inverse document frequency, among the rows in scope, of the terms it holds.
- **`@objectstack/knowledge-turso`.** A term of three characters or more is one quoted FTS5 phrase (so `X-200` is never FTS5 syntax) in a contentless trigram index beside each passage table (`<table>-kw`, `<table>-fts`), kept in step by triggers on every write and removal and dropped with the table. A shorter term is matched by `LIKE` over the rows in scope. A passage table made by an earlier release gets its keyword index at its first search, built from its rows in one transaction.
- **`@objectstack/knowledge-pgvector`.** A word of three characters or more is a phrase on `to_tsvector('simple', content)`, served by a GIN expression index on each passage table (`knowledge_vec_d<width>_content_tsv`). A shorter term, or one holding a Han, kana or Hangul character (the parser keeps a run of them as one word), is matched by `ILIKE`. A passage table made by an earlier release gets the index from the first write or search of its width; `CREATE INDEX` blocks writes to that table while it builds.

A hit's `score` is now the fused rank, normalized to `(0, 1]`: 1 for a passage first in both legs, 0.5 for one first in only one. It was the cosine similarity; anything that compared it with a fixed threshold reads it again. Nothing to migrate.
