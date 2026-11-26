---
'@objectstack/spec': minor
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-memory': patch
'@objectstack/embedder-openai': patch
'@objectstack/service-settings': patch
---

feat(service-knowledge)!: one splitter in the knowledge service (whole / recursive / markdown, aware of Chinese text), the chunk channel to adapters, and the `split` key on an object source; `KnowledgeChunk.metadata` and the Knowledge page's chunk overlap retired

Clause-②: yes (narrowing) — widens the knowledge contract (the `split` key, `chunks`, `headingPath`, the adapter's `capabilities` and `embedding`, `IEmbedder.maxInputTokens`, the reindex `failed` / `failures`) and narrows two accept sets: `KnowledgeChunk.metadata` is refused, and `knowledge.chunk_overlap` is no longer a key of the `knowledge` settings namespace
Metadata-protocol: narrowed
Skills-docs: none in this change — `skills/objectstack-ai/SKILL.md` lists the object source's keys and does not yet name `split`, and names neither retired key; that file is a governed surface outside this change, so teaching the new key is left to its owner. `content/docs/protocol/knowledge.mdx` (new section 3.5) and `content/docs/ai/knowledge-rag.mdx` document the key, the strategies, the limits and the removals in this change.

<!-- adr-0087: registered knowledge-chunk-metadata-retired -->

**BREAKING** in two places, each with its fix:

- `KnowledgeChunk.metadata` (`@objectstack/spec/ai`): FROM an optional `Record<string, unknown>` accepted and stripped TO a `retiredKey()` tombstone — `KnowledgeChunkSchema.parse()` (and a `KnowledgeDocument` whose `chunks` carry one) refuses it with the prescription, and `tsc` types the key `never`. Nothing ever wrote or read it: the knowledge service cuts the passages and sets no per-passage metadata, and no adapter consulted one. The fix: delete the key; a passage takes its document's `metadata` (`KnowledgeDocument.metadata`), which is what adapters filter on. D3 entry: `knowledge-chunk-metadata-retired`.
- `knowledge.chunk_overlap` (the Knowledge settings page's **Chunk overlap**): FROM a `number` key of the `knowledge` settings namespace (default 80) TO no key — the page no longer shows it, the service no longer resolves it, and a write naming it is refused `400 UNKNOWN_KEY`. Nothing ever read it and the splitter cuts without overlap, so a value set there never had an effect. A stored value is kept, never deleted. The fix: stop writing the key (a script or seed that sets it); there is nothing to replace it with. **Target chunk size** (`knowledge.chunk_target`) is the setting that now shapes passages.

The knowledge service now cuts documents into passages itself, once, and hands the same passages to every adapter that accepts them, so one source gives the same passages on each adapter.

New in `@objectstack/spec`, all optional:

- `ObjectKnowledgeSource.split?`: `{ strategy: 'whole' | 'recursive' | 'markdown', maxChars?, minChars? }`. Omitted, documents are cut `recursive`. New exports `KnowledgeSplitSchema`, `KnowledgeSplitStrategySchema` and the types `KnowledgeSplit`, `KnowledgeSplitStrategy` (`@objectstack/spec/ai`).
- `KnowledgeDocument.chunks?`: the document's passages, set by the service. `KnowledgeChunk` gains `headingPath?` (the headings a passage sits under, outermost first); its `id` is set by the service to `documentId#index`.
- `IKnowledgeAdapter.capabilities?: { chunks?: boolean }`: an adapter that sets `chunks: true` receives every document with `chunks` and indexes those passages as given. An adapter that does not set it receives whole documents, without `chunks`, as before.
- `IKnowledgeAdapter.embedding?: { maxInputTokens? }` and `IEmbedder.maxInputTokens?`: the longest input the adapter's embedder accepts, in tokens. The service reads it each time it splits. New exported types `AdapterCapabilities`, `AdapterEmbeddingDescriptor` (`@objectstack/spec/contracts`).
- `KnowledgeReindexResult.failed?` and `failures?` (`[{ documentId, reason }]`, at most 20 named; `failed` counts all).

How the service cuts (`@objectstack/service-knowledge`):

- `recursive` cuts at blank lines, then line breaks, then sentence ends, then semicolons, then characters. `。？！` end a sentence anywhere; `. ? !` only before whitespace or the end of the text, so 「3.2 条」 and 「400.50 元」 stay whole; an end mark followed by a closing quote or bracket ends nothing. A Markdown table or list item is never cut while it fits; a table that does not fit is cut between rows, each piece repeating the header row. Adjacent pieces shorter than `minChars` (default 200) are merged.
- `markdown` cuts one section per heading; every passage begins with its heading path, which counts toward its length and is embedded, and carries it as `headingPath`.
- `whole` keeps one passage per document.
- A passage is at most `split.maxChars` characters, else the settings page's `knowledge.chunk_target`, else 800; and, when the adapter reports `embedding.maxInputTokens`, its `estimateTokens` is at most 80% of that limit.
- A `whole` document over that budget is removed from the index and reported, never truncated: `reindexSource` counts it in `failed` and names it in `failures`, the record event sync logs it at `error` (source, record id, estimate, limit), and `indexDocument` throws. With no limit known nothing is checked.
- `indexDocument` refuses a document that already carries `chunks` (it throws, naming the field), as it refuses `docHash`.
- Known limit: `docHash` does not cover the passages, so a changed `split`, `chunk_target` or embedder limit re-splits a document only when the document itself next changes. The index fingerprint (ADR-0161 K7) will rebuild a source when its split changes.

`@objectstack/knowledge-memory` no longer splits documents itself: it declares `capabilities.chunks` and indexes the service's passages as given (a document handed to it directly without `chunks` is one passage of its whole text). Its hits are now the service's passages, with the service's `chunkId`s.

`@objectstack/embedder-openai`: `OpenAIEmbedder.maxInputTokens` is now public (`IEmbedder.maxInputTokens`): the `maxInputTokens` option, else the model's documented limit from the known-model table, else absent.

`@objectstack/service-settings`: the Knowledge page's **Target chunk size** (`knowledge.chunk_target`) is now read: it is the splitter's `maxChars` beneath a source's own `split.maxChars`, and it is shown for the in-memory adapter too. **Chunk overlap** (`knowledge.chunk_overlap`) is retired: nothing ever read it and the splitter cuts without overlap. The `knowledge` manifest is now `version: 2`. A stored value for it is kept, never deleted; it is no longer shown or resolved, and a write naming it is refused `400 UNKNOWN_KEY`.

`@objectstack/service-knowledge/testing`: `runKnowledgeAdapterContract`'s `implements` gains a required `chunks: boolean` (whether the adapter sets `capabilities.chunks`), and the suite runs the chunk-channel cases for it.

What to do:

- An adapter package that runs `runKnowledgeAdapterContract`: add `chunks: false` to `implements` (or `chunks: true` once the adapter takes the service's passages).
- An adapter that wants the service's passages: set `capabilities: { chunks: true }`, index each `doc.chunks` entry as given, and report its embedder's limit as `embedding.maxInputTokens` (from `IEmbedder.maxInputTokens`), from a getter if the embedder resolves late.
- A caller of `indexDocument` stops setting `chunks`.
- A deployment that set **Chunk overlap**: nothing to do; the value had no effect and keeps having none. A script or seed that writes `knowledge.chunk_overlap` drops the key.
- Code or a test that builds a `KnowledgeChunk` with `metadata`: delete the key; filter on the document's `metadata`.

The retirement kit: the `retiredKey()` tombstone on `KnowledgeChunkSchema.metadata` in `ai/knowledge-document.zod.ts`, `RETIRED_KEYS_BY_MAJOR[18]` row `ai/KnowledgeChunk:metadata`, D3 `knowledge-chunk-metadata-retired` with its step-18 rationale fragment (no D2 conversion: a chunk is a runtime contract shape, never stored in stack metadata, so `os migrate meta` has no source to rewrite — the `ActionDescriptor.isAsync` disposition), the `[RETIRED]` line in `authorable-surface/ai.json`, the regenerated `knowledge-document.mdx` reference, and the pin `ai/knowledge-document.test.ts`. The settings key follows the Localization format keys' retirement: the specifier removed from `knowledge.manifest.ts` and from the 11 translation packs, the manifest at `version: 2`, stored rows kept, and the manifest pins updated.
