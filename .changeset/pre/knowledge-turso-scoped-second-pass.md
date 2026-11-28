---
'@objectstack/knowledge-turso': patch
---

perf(knowledge-turso): a narrowly scoped vector search tries a wider approximate pass before the exact scan

Clause-②: no
Metadata-protocol: none

The approximate vector leg runs the exact scan when its filter leaves fewer than 8 × `topK` candidates in scope. A search whose scope keeps a fifth of the passages or less hit that floor almost every time and paid the full exact scan. Such a leg now first reads 10 times the candidates once, with the same `WHERE` and the same floor. It keeps that answer only if it clears the floor, and otherwise runs the exact scan as before.

- **Where it runs.** With no scope, or a scope that holds a parent (metadata) term. A scope of record terms alone keeps the old path: its exact scan reads only the rows in scope through the record index, and that costs less than the wider pass.
- **When it is skipped.** When the first pool, times 10, cannot reach the floor, for example a scope of one or two passages. Those go to the exact scan without the extra pass.
- **Measured** at 200,000 passages of 1,536 dimensions (clustered synthetic, `topK` 10, 50 queries per share), under a parent scope keeping 10%, 15% and 20% of the passages: p95 351, 328 and 337 ms, against 848, 907 and 908 ms for the exact scan. recall@10 is the same as the floor's alone.

No option and no export changes, and there is nothing to migrate.
