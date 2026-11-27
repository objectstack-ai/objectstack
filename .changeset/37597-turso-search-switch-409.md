---
'@objectstack/knowledge-turso': patch
---

Clause-②: no
Metadata-protocol: none

knowledge-turso: a search whose source's index is switched by a rebuild on each of its three attempts now answers `CONCURRENT_MODIFICATION` (409), the same coded answer the pgvector store gives, instead of `SERVICE_UNAVAILABLE` (503). The store was ready all along; running the same search again answers. The retry count and every other search answer are unchanged.
