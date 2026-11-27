---
'@objectstack/knowledge-pgvector': patch
---

fix(knowledge-pgvector): `dropSource` removes a source that another process is building, and that build cannot bring it back

Clause-②: no
Metadata-protocol: none

`IKnowledgeAdapter.dropSource` drops every generation of a source, "the one under construction included". On the pgvector store two cases did not hold while another process was building the same source and held its builder lock. Both were measured on a live PostgreSQL 16 with pgvector.

- **A generation a concurrent `beginBuild` opened survived the drop.** When the drop waited on the row lock of a build that was opening its generation, the drop's locking read could not see the row that transaction inserted. The drop then retired only the active generation, and the new one stayed `building`, holding whatever the build wrote next. The drop now locks the source's rows and then retires every generation in one statement of its own, so the generation opened by the transaction it waited on is retired too.
- **The other build's next write brought the dropped source back.** Its builder lock was still held, so its next page found no generation and opened a new active one. The store then served whatever that build wrote from that point on. A build's write, listing and completion now go only to the generation that build began. When that generation is gone, because the source was dropped in any process or another build replaced it, the call is refused `LOCK_CONFLICT` (409) and the build ends and lets go of its lock. A completion with no write since the drop is refused the same way. Before, it threw an error with no code.

A drop of a source that holds nothing, racing a `beginBuild` that opens the source's first generation, is still settled as drop-then-build: the build's generation is kept. Event-sync writes are not fenced. Nothing to migrate.
