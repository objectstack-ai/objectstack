---
'@objectstack/knowledge-turso': patch
---

fix(knowledge-turso): a build that keeps going after `dropSource` cannot bring the dropped source back

Clause-②: no
Metadata-protocol: none

`IKnowledgeAdapter.dropSource` removes every generation of a source, "the one under construction included", and afterwards a source registered again under the same key is built from nothing. On the turso store a build of the source that was under way when it was dropped, in another process or in the same one, broke that: its next page found no generation and opened a new active one, and the rest of the walk landed there, so the store served the dropped source again.

A build's writes, listing and completion now go only to the generation that build began. When that generation is gone, because the source was dropped or another build under another fingerprint replaced it, the call is refused `LOCK_CONFLICT` (409), the same code and status the pgvector store answers, and the build ends; nothing is opened. A completion of such a build is refused the same way (before, it threw an error with no code). The build knows its generation by its number, the time its row was made and its fingerprint, so a later generation that takes the same number after a drop is never taken for it.

A build that begins after the drop builds the source from nothing, as before. Writes outside a build (event sync) are not fenced. Nothing to migrate.
