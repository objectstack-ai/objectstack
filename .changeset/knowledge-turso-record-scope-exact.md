---
'@objectstack/knowledge-turso': patch
---

perf(knowledge-turso): a narrow record-only scope goes straight to the exact scan

Clause-②: no
Metadata-protocol: none

A vector search whose scope is record ids alone (no parent term) ran the approximate one-bit pass first, then the exact scan whenever the pass kept too few candidates in scope. Since the record index lets that exact scan read only the rows in scope, a narrow scope paid for both. The adapter now estimates how many passages such a scope keeps and goes straight to the exact scan when the first pass's `topK × vectorIndexOverfetch` candidates are not expected to keep 1.25 × the floor of 8 × `topK` in scope. With the default 40 candidates a hit, that is a scope of under 25% of the source's passages. The estimate counts, through the record index, the passages of at most 256 of the scope's ids (all of them when there are no more), so a record split into many passages counts as many. It costs one statement of about 1-2 ms at 200,000 passages.

Measured at 200,000 passages of 1,536 dimensions (clustered, topK 10, 50 record-scoped queries a share), p95 in ms before → after: BENCH_TABLE. Recall@10 against the exact scan is equal or higher at every share. A scope with a parent (metadata) term and a search with no scope keep the approximate path, the second pass included. Nothing to configure or migrate.
