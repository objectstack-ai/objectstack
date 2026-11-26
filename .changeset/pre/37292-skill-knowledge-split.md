---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ai` teaches the knowledge source `split` key and names the two keys retired beside it

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md`, *Knowledge Sources (RAG)*:

- The object source's fields gain `split?`, and a passage teaches `split: { strategy, maxChars?, minChars? }`, an object-source key: `recursive` (the default) for prose, `markdown` for documents with headings, `whole` for short records only, since a document over the embedder's input budget is removed from the index and reported, never truncated. `maxChars` overrides the **Target chunk size** setting (`knowledge.chunk_target`, else 800), the embedder's input limit can lower it, and `whole` ignores it; `minChars` defaults to 200. Changing `split` re-splits a document only when the document next changes. The key applies to an adapter that declares `capabilities.chunks` (`memory`); one that does not (`ragflow`) receives whole documents, and `split` has no effect on it.
- It names the two keys retired with the splitter, and that each is refused when written: the `knowledge.chunk_overlap` setting (`400 UNKNOWN_KEY`; passages never overlap) and `KnowledgeChunk.metadata` (a parse error; a passage takes its document's `metadata`).
- The closing note that said chunking is not platform metadata is replaced: the service splits; top-K, score thresholds and rerankers are not source metadata and belong to the adapter or application code.

Paid for by deleting restatement in the same file, with the token ceiling unchanged (6801; the file now measures 6800):

- the pitfall "Indexing everything" (the `object` row's hygiene column says the same);
- the "Skills are your entry point" paragraph under the diagram (the frontmatter description, the `tools` row and *Platform agents* say the same);
- the incident sentence after `ai-skill-tool-unresolved`;
- the sentence saying what `os validate` confirms;
- the clause of the *App AI Blueprint* registration row repeating three facts stated in their own sections;
- four clauses that repeated the sentence beside them: "A skill names a platform tool or an `action_<name>`" (*Tool metadata*), "the user never picks from a roster…" (*Platform agents*), "without one the id is unresolvable" (*Wiring*), and "exposure is never automatic" (*Actions as AI Tools*).

`evals/skills-tools-knowledge.json`: a new case 9 asks for a Markdown handbook source on the in-memory adapter, split by section at 600 characters with overlapping passages; the expected answer writes `split: { strategy: 'markdown', maxChars: 600 }` and declines the overlap. Case 3 (RAGFlow) no longer says chunking is adapter config: its expected answer writes no `split`, because that adapter receives whole documents.
