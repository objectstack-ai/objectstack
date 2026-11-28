---
'@objectstack/knowledge-turso': patch
---

perf(knowledge-turso): a narrow record-only scope goes straight to the exact scan

Clause-②: no
Metadata-protocol: none

A vector search whose scope is record ids alone (no parent term) ran the approximate one-bit pass first, then the exact scan whenever the pass kept too few candidates in scope. Since the record index lets that exact scan read only the rows in scope, a narrow scope paid for both. The adapter now estimates how many passages such a scope keeps and goes straight to the exact scan when the first pass's `topK × vectorIndexOverfetch` candidates are not expected to keep 1.25 × the floor of 8 × `topK` in scope. With the default 40 candidates a hit, that is a scope of under 25% of the source's passages. The estimate counts, through the record index, the passages of at most 256 of the scope's ids (all of them when there are no more), so a record split into many passages counts as many. It costs one statement of about 1-2 ms at 200,000 passages.

Measured at 200,000 passages of 1,536 dimensions (clustered, topK 10, 50 record-scoped queries a share), p95 in ms before → after: 5% in scope 219 → 74, 10% 321 → 143, 20% 418 → 289 (the exact scan alone: 81, 154, 291); at 25%, 30%, 35% and 50% the path is unchanged (190 → 206, 187 → 204, 206 → 207, 223 → 228, the one added statement costing 1-2 ms). Recall@10 against the exact scan is equal or higher at every share (0.994 → 1.000 at 20%). A scope with a parent (metadata) term and a search with no scope keep the approximate path, the second pass included. Nothing to configure or migrate.
