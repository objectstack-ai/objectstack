# ADR-0161: The knowledge platform boundary — the platform owns document assembly, sync and reconcile, structural split and record-level return; adapters own embedding calls, hybrid retrieval, rerank and file parsing; `knowledge_source` is a governed metadata type

**Status**: Proposed — 2026-11-24, written for objectstack#37001 on the maintainer's ruling of that day, 「需要拍板的事项 都同意」, as the card's filing gate records it. `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted** by an authorized approval or the maintainer's merge of the PR that carries it, and is in force from that merge. **This record declares; it implements nothing** — no schema, no contract member, no code, no changeset; every mechanism below lands through a child of the epic [#37000](https://github.com/objectstack-ai/objectstack/issues/37000) ([Execution](#execution-after-acceptance)). It is the **mechanism half** of cloud ADR-0119 ([Provenance](#provenance)). **Three points go past the rulings' words**; each is marked ▲ where it stands. **Where the maintainer's contract input leaves a shape to this record, the record decides it**, and marks the choice ◆. Both lists are in [Points the rulings do not settle](#points-the-rulings-do-not-settle), for the approver to accept with the record or strike.

- **Date**: 2026-11-24
- **Card**: [#37001](https://github.com/objectstack-ai/objectstack/issues/37001) (p2, `area:ai`), a phase 1 child of the epic #37000. Its seven "What" items are this record's required content; [K1](#k1--the-boundary) to [K9](#k9--one-search_knowledge-definition-and-every-knowledge-tool-goes-through-the-tool-registry-and-the-mcp-seams) answer them one by one.
- **Decided by**: the maintainer, 2026-11-24, verbatim and untranslated: 「需要拍板的事项 都同意」. The card's filing gate records what the words were given on. Its line, as the card carries it:

  > Key words: 「需要拍板的事项 都同意」 (D1: platform owns assembly, sync & reconcile, structural split, record-level return; adapters own embedding calls, hybrid retrieval, rerank, file parsing — D2: `knowledge_source` becomes a governed metadata type referencing objects; no recipe on the object — D5: a source lists its content fields explicitly).

  The epic #37000 carries the same words beside 「专题 ② 知识检索平台化 也一起立」, and its start beside 「37000 现在就启动，就是要和你讨论分阶段」 and 「合并，按四阶段改，先立第一阶段的卡」 (record [`7135335668`](https://github.com/objectstack-ai/objectstack/issues/37000#issuecomment-7135335668)).
- **Numbering**: `D1`, `D2` and `D5` in the quoted line number the decision list the maintainer agreed to. Cloud ADR-0119 has its own `D1` to `D6`. This record's decisions are numbered **K1 to K10** so that the three lists never collide; "ruling D1", "ruling D2" and "ruling D5" below always mean the quoted line.
- **Contract input**: the maintainer session's comment [`7142505760`](https://github.com/objectstack-ai/objectstack/issues/37001#issuecomment-7142505760) on #37001, headed "Input for this ADR's contract section". It lists sixteen contract additions proposed by the epic's phase-2 cards, each with a proposed first reader, and says: "The cards cite this ADR as the authority, and the ADR decides the final shapes." [K8](#k8--the-contract-additions-decided-item-by-item) answers the sixteen one by one.
- **The rulings this record executes** (⛔ none is re-opened here): ruling D1, ruling D2 and ruling D5 above; and the epic's "Rulings that bound every child", carried in [K10](#k10--what-this-record-does-to-other-records-and-the-rules-every-child-carries).
- **Supersedes**, each by name in [K3](#k3--what-this-record-supersedes): the three judgements of #4606 and its restart condition; the adapter-list deferral written in `packages/services/service-knowledge/src/knowledge-service-plugin.ts`; the no-reconcile option ruled on #4672; the maintainer's 2026-11-15 words on #33933.
- **Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source per type), [ADR-0049](./0049-no-unenforced-security-properties.md) and [ADR-0078](./0078-no-silently-inert-metadata.md) (a declared key is enforced or it is not declared; a key lands with its reader), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (conversions, tombstones and the migration chain), [ADR-0088](./0088-metadata-kind-admission-and-retirement.md) (the kind admission test), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D10 (an agent reads as the principal it acts for), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (coded refusals), [ADR-0149](./0149-ai-answers-business-questions-through-the-dataset-semantic-layer.md) D2 (one tool definition, one executor, every transport), [ADR-0159](./0159-forms-are-their-own-metadata-type-public-forms-are-form-items-view-is-lists-only.md) (the latest kind admission, followed for the form of K4), and [`ADR-0057-system-data-lifecycle-and-retention`](./0057-system-data-lifecycle-and-retention.md) (the reap guard the knowledge plugin registers).
- **Leaves unchanged**: permission-aware retrieval (every object-source hit is re-read as the caller, and a source is searched for a caller only after the exposure and field-level admission of PR #36850); the reap guard of #4672 as landed; the signature and return type of `IKnowledgeService.search`; the settings shape of #33933 (knowledge settings only where the service is mounted), which #37102 keeps: without the capability token there is no knowledge service and no knowledge settings page; the open AI door, which stays MCP-only (cloud ADR-0119 D4).
- **Inputs**: every code and docs text quoted below was read on `objectstack-ai/objectstack` `main` at `254e396a29`, the commit this record's branch starts from. Positions are in [Readings](#readings-taken-at-254e396a29). PR #36823 and PR #36850 are merged and are in that tree; PR #37075 is open and edits §6 of `content/docs/protocol/knowledge.mdx`, so the §6 quotations may move when it lands.

---

## Provenance

1. **The cloud record.** Cloud ADR-0119, [`docs/adr/0119-record-context-and-vector-stores-open-ai-read-governance-enterprise.md`](https://github.com/objectstack-ai/cloud/blob/main/docs/adr/0119-record-context-and-vector-stores-open-ai-read-governance-enterprise.md) in `objectstack-ai/cloud`, written on card objectstack-ai/cloud#4960. The maintainer approved it on 2026-11-24 (「4968 我批准了，你修改完可以落地」) and it merged that day through objectstack-ai/cloud#4968, merge `0aa3c54`; it is Accepted. It draws the open and closed line for record context and for vector stores. That is a commercial boundary, so by Prime Directive #13 it lives in the cloud registry and is cited from here as `cloud ADR-0119`, never as a bare number.
2. **This file is the mechanism half.** Cloud ADR-0119 names three things it does not decide and leaves to this card: the knowledge adapter contract, the admission of `knowledge_source`, and the splitter. They govern open code in this repository, so this repository carries the record, under its own number. The commercial half stays in cloud and is not restated as a decision here.
3. **Where the cloud facts in this record come from.** The cloud repository was not readable from the session that wrote this record. Every statement about cloud ADR-0119 below is taken from two records on this repository's tracker and from nowhere else:
   - the cloud seat's confirmation, comment [`7136374724`](https://github.com/objectstack-ai/objectstack/issues/37001#issuecomment-7136374724) on #37001, read at the draft head `e4dad2f` before the merge;
   - the maintainer session's notice, comment [`7136912027`](https://github.com/objectstack-ai/objectstack/issues/34830#issuecomment-7136912027) on #34830, written after the merge. It names what changed from the draft: D3 and D11 are quoted verbatim, D6 lists where the Enterprise value sits without committing knowledge features, and `search_knowledge` needs no narrowing change.
4. **The pointer back.** Prime Directive #13 asks that the cloud record gain a one-line pointer to this number. The PR that lands this file cannot write to the cloud repository; the pointer is owed by the cloud lane after this record merges.
5. **Card and epic.** #37001, filed by the maintainer's session under the epic #37000, whose phase tables are the source of the row numbers this record uses ("row 3", "row 15", and so on). Where a row has been filed as a card, the record names the card.

---

## TL;DR

1. **The platform owns four things, for every adapter**: building a document from a record (assembly), keeping the index equal to the source (sync and reconcile), cutting a document into passages by its structure (structural split), and answering a search with records, not loose passages (record-level return). **Adapters own four**: the embedding calls, hybrid retrieval, rerank and file parsing ([K1](#k1--the-boundary)).
2. **The sentence "ObjectStack does not ship its own RAG engine" is retired**, with the other texts that state the old position. Each is rewritten by the child whose code makes the new sentence true, never ahead of it ([K2](#k2--the-texts-this-record-revises)).
3. **Four earlier positions are superseded by name**: #4606, the adapter-list deferral, #4672's no-reconcile option, and the 2026-11-15 words on #33933 ([K3](#k3--what-this-record-supersedes)).
4. **`knowledge_source` is a metadata type.** It references an object and carries the recipe itself; the object carries none. It passes ADR-0088's three clauses, its v1 keys are only the ones something enforces, and naming an adapter becomes optional ([K4](#k4--knowledge_source-is-admitted-as-a-metadata-type)).
5. **A source lists its content fields.** `'*'` is refused: embedding sends text out of the row store, so the source must say which fields leave ([K5](#k5--a-source-lists-its-content-fields-embedding-is-egress)).
6. **Two keys are renamed and three are removed, under ADR-0087**: `id` → `name`, `contentFields` → `content`; `embedding`, `vectorStore` and `refresh.cron` go ([K6](#k6--adr-0087-dispositions)).
7. **One fingerprint per index**: embedding model, dimensions, split configuration, split algorithm version and content recipe. A changed fingerprint is a new generation; an index never mixes two, on a write or on a search. A second hash names the smaller change that is repaired inside a generation ([K7](#k7--one-index-fingerprint-a-changed-fingerprint-is-a-new-generation)).
8. **The adapter contract grows by a decided list.** Each of the maintainer's sixteen contract items is accepted, deferred or refused here, with its final shape and the card that first reads it. This record adds no member ([K8](#k8--the-contract-additions-decided-item-by-item)).
9. **`search_knowledge` has one definition for every transport**, `aiExposed` stays enforced at the tool layer, and every knowledge tool is an ordinary tool call through the tool registry and the MCP seams ([K9](#k9--one-search_knowledge-definition-and-every-knowledge-tool-goes-through-the-tool-registry-and-the-mcp-seams)).
10. **Three points go past the rulings' words** and are the maintainer's: the fate of the `file` and `http` shapes and of the push door, what "content recipe" covers, and what happens to registration in code. The shapes this record decides on the contract input are listed beside them ([Points the rulings do not settle](#points-the-rulings-do-not-settle)).

---

## Context

### The position this record replaces

Until 2026-11-24 the recorded position was that knowledge is a plug point and the platform builds no part of retrieval. `content/docs/protocol/knowledge.mdx` opens with "ObjectStack does not ship its own RAG engine." The service class note in `packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeService` lists "Chunking, embedding, vector storage, hybrid retrieval, rerank" as "the parts plugins own". The decision behind those texts is #4606 (2026-08-02), and #4672 and the code comments of the knowledge plugin were written inside its boundary.

### What the code does today

Read at `254e396a29`:

- **Assembly is already the platform's.** `packages/services/service-knowledge/src/knowledge-service.ts#recordToDocument` builds one document per record from the source's `contentFields`, in order, and skips credential-class and `internal` fields. A member `'*'` takes every non-empty string value of the record except `id`. The title is read from a field named `title` (#36994 is the open card).
- **Sync is the platform's, and incomplete.** `handleRecordUpsert` and `handleRecordDelete` of `packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeService` run inline on per-record events. The upsert path builds from the event body and does not read the source's `where` (#36991, PR #37075 open). `reindexSource` reads the whole object in one `find` and upserts it in one call (#36992). It only upserts: a document whose record no longer matches stays in the index, because the adapter contract has no way to list what an index holds.
- **Nothing in the service splits.** Each adapter does what it likes: `knowledge-memory` cuts on paragraph boundaries with a soft 800-character cap, and `knowledge-ragflow` posts each document as one chunk. The same source gives different passages on different adapters. (`knowledge-ragflow` is being retired whole by #37004, on the maintainer's ruling recorded in comment [`7134290286`](https://github.com/objectstack-ai/objectstack/issues/36839#issuecomment-7134290286) on #36839. This record builds nothing on it.)
- **Search returns passages.** `search` returns chunk-level hits, filtered by the caller's permissions and cut at `topK` (#36993 covers the missing refill). Several passages of one record take several slots.
- **The adapter contract** is `upsert`, `search`, `delete` and an optional `healthCheck` (`packages/spec/src/contracts/knowledge-adapter.ts#IKnowledgeAdapter`).
- **The service also has a push door.** `indexDocument` and `deleteDocument` on `packages/spec/src/contracts/knowledge-service.ts#IKnowledgeService` hand a document the caller built straight to the adapter. Nothing in this tree calls them, tests aside.
- **A source is a code registration, not metadata.** The note on `packages/spec/src/ai/knowledge-source.zod.ts#KnowledgeSourceSchema` reads "the shape of a **runtime registration**, ⛔ not a governed metadata type", while `content/docs/protocol/knowledge.mdx` says a source "is stored as metadata (versioned, environment-scoped) just like a view or a flow". The schema note is the true one: no knowledge entry exists in `packages/spec/src/kernel/metadata-plugin.zod.ts#DEFAULT_METADATA_TYPE_REGISTRY`.
- **Some declared keys have no reader.** No file under `packages/services/service-knowledge/src`, `packages/plugins/knowledge-memory/src` or `packages/plugins/knowledge-ragflow/src` (tests aside) reads a source's `embedding`, `vectorStore` or `refresh.cron`, nor the `file` kind's `prefix` and `mimeTypes`, nor the `http` kind's `urls` and `userAgent`. For a `file` or `http` source `reindexSource` answers `ok: false` and tells the caller to trigger ingestion through the adapter.

### The consumer that exists

The work written under #4606 waited for a real object source: the knowledge plugin's comments say "until a real object source justifies" the addition, and the ruling on #4672 says 「待真实 object 源出现」. One exists. The BrightRule application mounts `KnowledgeServicePlugin` with one object source over its policy clauses and a vector adapter; the body of #36650 describes it and its evaluation over the MCP door. That card's own defect, no knowledge tool on the MCP door, is fixed by PR #36823. What it leaves is the application's own vector code and derived mirror, which the epic names as the thing the platform takes over.

### What cloud ADR-0119 requires of open code

From comment `7136374724` on #37001:

1. Every new knowledge or context tool is an ordinary tool call through the existing tool registry and the MCP tool seams, so that the Enterprise interceptors apply without new code. The cloud record's Consequences, as that comment quotes them: "A tool that bypasses those seams would be a governance gap and is refused in review."
2. Knowledge indexing honours the field-egress declaration: the cloud record's D2 lists knowledge indexing among the AI read paths.
3. Both vector stores are open (its D5): `knowledge-turso` moves to this repository under Apache-2.0 beside a new `knowledge-pgvector`. The service-layer splitter, record-level return and sync correctness are open as part of the knowledge service.

---

## Decision

### K1 — The boundary

Ruling D1, as two lists. The left one is the knowledge service's work, done once for every adapter. The right one is each adapter's own.

| The platform owns | What that means |
|:--|:--|
| **Document assembly** | A record becomes a document by the source's recipe: which fields are content, which are metadata, what the title is, and which fields an index never carries. One function decides. No adapter builds a document from a record, and no caller hands an object source a document it built itself. |
| **Sync and reconcile** | Events keep an index fresh; a reconcile pass keeps it correct. The service decides which documents an index must hold, writes the missing ones and removes the stale ones. A rebuild is paged. |
| **Structural split** | The service cuts a document into passages by its structure and hands the adapter the passages. One splitter serves every adapter that takes chunks, so one source gives the same passages on each of them. |
| **Record-level return** | A search can answer with records: the passages of one record are grouped, and the caller learns which records matched and by which passages. |

| The adapter owns | What that means |
|:--|:--|
| **Embedding calls** | Turning passages and queries into vectors, through the embedder the deployment configures (`packages/spec/src/contracts/embedder.ts#IEmbedder`). When to call, how to batch, and whether to call at all (an engine that embeds inside itself makes no call) are the adapter's. |
| **Hybrid retrieval** | How vector and keyword scores are blended, which index or scan is used, and how candidates are found. |
| **Rerank** | Whether a second model reorders candidates, and which. |
| **File parsing** | Turning a PDF, a scan or an office file into text. |

**Why the line is here.** The four on the left need facts only the platform has: the object's fields and their protection, the caller's permissions, the record events, and which record a passage came from. The four on the right need none of those, and they are where dedicated engines are better than anything this repository would write.

**What follows from the two lists.**

- An adapter indexes the passages it is handed. It does not read records, does not decide which records belong to a source, does not split a passage again, does not group hits by record and does not check permissions. An adapter that does not declare it takes chunks keeps receiving whole documents, as today (K8, item 5); every adapter this repository ships declares it.
- The service does not choose a model, compute a vector, score a candidate, rerank or parse a file.
- The index is a copy for ranking and snippets. An answer reads content as the asking user, through the record tools; this is the epic's rule and K10 carries it.
- The split strategies and their rules belong to the splitter's card, #37098 (`whole`, `recursive`, `markdown`, aware of Chinese text). This record fixes who owns the split and where its key lives (K8, item 10).
- **Why the purge and the grouping run in the service, not in SQL** (Prime Directive #5). The index sits behind the adapter contract and may live in another store than the records, so the anti-join that finds stale documents and the grouping of hits by record cannot be pushed down in general. An adapter that shares a database with the records may do either in SQL later; that is K8's item 13, and it comes back with its reader.

**The push door.** `indexDocument(sourceId, doc)` and `deleteDocument(sourceId, documentId)` hand a caller-built document to the adapter. On an object source that contradicts the first row above and K5: a pushed document is not built by assembly, so neither the content list nor the egress rule binds it, and the purge of #37096 removes it at the next complete rebuild, because no record answers for it. So **both calls are refused on an object source**, with a coded refusal (ADR-0112), from row 3 at the latest; an earlier card that touches the door may land the refusal sooner. They remain the write door of a source that is not an object source. Whether v1 has such a source is point 1 (K4): if that point stands, the two methods leave `IKnowledgeService` with the `file` and `http` arms.

### K2 — The texts this record revises

Each text below states the old position. The left column quotes it as it reads at `254e396a29`; positions are in [Readings](#readings-taken-at-254e396a29).

| Text | What it becomes | Rewritten by |
|:--|:--|:--|
| `content/docs/protocol/knowledge.mdx`, opening: "ObjectStack does not ship its own RAG engine. The market has many mature options (…) and competing with them on chunking, embeddings, hybrid retrieval, and rerankers is not where the framework can add value." | The platform owns assembly, sync and reconcile, structural split and record-level return. Engines are integrated for embedding, hybrid retrieval, rerank and file parsing. Chunking leaves the list of things the framework does not do. | #37096 (row 2) |
| Same file, §1: "We have nothing distinctive to add to those layers." and "The protocol scopes the framework's responsibility to (1)–(4) and delegates the rest to plugins." | The framework's list grows by the four of K1; what is delegated is the adapter's four. | #37096 |
| Same file, §3.1: a source "is stored as metadata (versioned, environment-scoped) just like a view or a flow", against the schema note on `packages/spec/src/ai/knowledge-source.zod.ts#KnowledgeSourceSchema`: "the shape of a **runtime registration**, ⛔ not a governed metadata type". | The two agree: a source is a `knowledge_source` item (K4). Until row 3 lands, the schema note is the true one. | row 3 |
| Same file, §3.2: "The framework does **not** chunk; adapters do." | The framework splits; adapters index the passages. | #37098 (row 6) |
| Same file, §3.4, and the note on `packages/spec/src/contracts/knowledge-adapter.ts#IKnowledgeAdapter`: "The surface is **deliberately minimal**: no chunk strategy, no embedding configuration, no rerank toggles." | The contract grows by K8's list. It carries what an adapter reports about its embedder and still no configuration, no rerank and no hybrid toggle. | #37096, then each card that adds a member |
| Same file, §6: "that surface stays unbuilt until a real `object` source calls for it." | The enumeration surface is built (K8, item 1); reconcile covers application-level predicate writes. | #37096 and row 15 |
| Same file, §7 and §8: `knowledge-pgvector` as "Phase 3", and "a `KnowledgeSource.embedding` field". | `knowledge-pgvector` is an open adapter of this repository (cloud ADR-0119 D5); `embedding` is removed (K6). | #37100, row 3 |
| `packages/spec/src/ai/embedding.zod.ts`, file note: "NOT in scope (these belong to application code, not the platform): Chunking strategies (fixed/semantic/recursive/markdown)." and "These were removed in v1 because they describe one specific way to build a RAG application". | Structural splitting is a platform capability of the knowledge service. It does not return as the pipeline vocabulary that was removed. Retrieval pipelines, document loaders and end-to-end orchestration stay out of scope. | #37098 |
| `packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeService`, class note: "Non-responsibilities (the parts plugins own): Chunking, embedding, vector storage, hybrid retrieval, rerank." | Chunking moves to the responsibilities, with reconcile and record-level return. Embedding calls, vector storage, hybrid retrieval and rerank stay the adapter's. | #37096, #37098 and #37103, each for its part |
| `packages/spec/src/ai/knowledge-document.zod.ts`, file note: "The framework does **not** prescribe chunk strategy or vector format. Adapters are free to chunk however they like", and the note on `#KnowledgeChunkSchema`: "Adapter-produced chunk of a document." | The framework prescribes the split and still not the vector format. A chunk is produced by the platform and handed to the adapter. | #37098 |

The same position is restated in `content/docs/ai/knowledge-rag.mdx` ("Why we did not build a vector DB"), in the READMEs of the knowledge packages and in `skills/objectstack-ai/SKILL.md`. They follow the same rule; `skills/**` is a governed surface and takes its own PR.

**The rule for all of them (Prime Directive #10).** A text is rewritten in the PR whose code makes the new sentence true, and not before. This record changes no file outside `docs/adr/`. A reader who meets an old sentence in the meantime finds this record through the ADR index.

### K3 — What this record supersedes

**1. The three judgements of #4606, and its restart condition.** #4606 (2026-08-02, closed 2026-09-24) recorded the maintainer's positioning in its body:

- Judgement 1: 「企业应用平台里,agent 的第一知识源是业务数据和元数据,不是文档库。」 and 「平台的差异化在治理(谁能检索什么,source 级权限),不在检索引擎」. The first sentence stands: an object source is business data. The second is replaced by K1. Beside governance, the platform owns the four parts of retrieval that depend on the record model.
- Judgement 2: 「现有架构姿态即终态:契约在核心,引擎靠集成。」 and 「知识库是插件位,不自建。开源核心零新增承诺。」 Replaced. The posture is not final: the open core takes on the four mechanisms of K1 and the contract additions of K8. "Engines by integration" stands for the adapter's four.
- Judgement 3: 「商业归属:企业版。」 and 「向量库/embedding/文档管道的成本结构是托管云付费点,不进开源核心。」 This is a commercial line and is not this record's to draw. It is replaced by cloud ADR-0119: both vector stores are open (its D5), and its D6 lists where the Enterprise value sits.
- The restart condition, 「重启触发条件(满足任一再评估,评估≠立项)」, listed three triggers, and 「触发后的既定路线」 put the work in cloud on the `knowledge-ragflow` route. Neither is applied. The maintainer restarted the work by his own words on 2026-11-24, and the route is the epic's four phases. The "real object source" that the cards written under #4606 waited for is BrightRule ([Context](#the-consumer-that-exists)).
- What stays of #4606: 「enforced 先行」. A key enters the spec with the path that reads it. It is the epic's rule now ("A key lands with its first reader in the same PR") and K4 applies it.

**2. The adapter-list deferral in `packages/services/service-knowledge/src/knowledge-service-plugin.ts`.** Three comments in that file hold the contract shut on #4606's authority: application-level predicate writes stay uncovered "until a real object source justifies the adapter-enumeration surface it would need (#4606's enforced-first rule)"; the reap guard was added with "No spec key, no `IKnowledgeAdapter` member, no `packages/objectql` change (#4606's zero-addition boundary)"; and the guarded object set is read once because making it dynamic "is precisely the addition #4606 rules out until a real `object` source exists to justify it". All three conditions are met and the deferral ends. Enumeration is K8's first item, with #37096 as its reader; the guarded set becomes dynamic in row 3. Those rows rewrite the comments.

**3. The no-reconcile option of #4672.** The maintainer's ruling of 2026-08-05 on #4672, relayed by the services lane's PM (record [`5194621834`](https://github.com/objectstack-ai/objectstack/issues/4672#issuecomment-5194621834)), approved option C: 「仅做 reap guard 去索引化(知识插件注册 lifecycle reap guard,行删除前按 id 去索引),零新增契约面、不碰 `packages/objectql`、不建对账子系统;应用层谓词写部分诚实不覆盖,待真实 object 源出现再按 #4606 的 enforced-先行原则回看(Q2 = B 现在 + A 待触发,同案批准)」.

- Superseded: 「不建对账子系统」 and 「应用层谓词写部分诚实不覆盖」. Reconcile is the platform's (K1). The 「A 待触发」 half, an enumeration method on the adapter, is triggered.
- Not revived: the earlier approval of a reconciliation subsystem on that card (record [`5163029794`](https://github.com/objectstack-ai/objectstack/issues/4672#issuecomment-5163029794), 2026-08-03), which the 2026-08-05 ruling voided. This record decides that reconcile exists and who owns it; its trigger and its batching are row 15's.
- What stays: the reap guard as landed, and its failure direction. A row may outlive its index entry; an index entry never outlives its row.

**4. The 2026-11-15 words on #33933.** The card body of #33933 records them: 「知识库 根本还没开始开发」 and 「知识库甚至不应该加载这个插件，目前不是本项目的重点」. They are superseded by the maintainer's words of 2026-11-24, as record [`7134104071`](https://github.com/objectstack-ai/objectstack/issues/33933#issuecomment-7134104071) on #33933 states. That card's own change stays valid (PR #36975: the knowledge settings appear only where the service is mounted). The default shape then changes on purpose and in two steps: #37102 mounts the service for an application that asks for the `knowledge` capability, and keeps that PR's pin for one that does not; row 3 mounts it where a `knowledge_source` item exists.

### K4 — `knowledge_source` is admitted as a metadata type

Ruling D2: `knowledge_source` becomes a governed metadata type referencing objects, and the object carries no recipe.

**ADR-0088's three clauses.**

1. **Independent lifecycle.** A source is created, changed, switched and removed under its own name. Its index is built, rebuilt as a new generation (K7) and dropped with it. It is not a facet of its object: two sources may index one object with different content, a different `where` and different readers, and today's docs already tell an author to put sensitive fields in a separate source. The object carries nothing: this record adds no object key, and the object-side AI declaration that exists, `enable.aiReadable`, is refused on business objects (`packages/spec/src/data/ai-read-exposure.ts`). This is not the `validation` case of ADR-0088's 2026-08 addendum. That kind failed the clause because the engine read only the shape embedded in the object, and a standalone item had no key to bind it to one. A source binds by `source.object`, and the service reads the standalone item.
2. **Declarative governability.** A source ships as a document in a package, through a file loader, and is authored at runtime through Studio and through MCP (`allowRuntimeCreate`); the epic's phase 3 states both. It is versioned. This record opens no environment overlay for it: `allowEnvironmentOverlay` keeps the registry's default, `false`, until a ruling says otherwise (ADR-0005).
3. **A real consumer.** The knowledge service reads `knowledge_source` items and its behaviour changes with them: it registers each source, builds and syncs its index, serves it in search, and lists it in every `search_knowledge` answer. The type and that reader land in one PR (row 3: registry row, stack collection, loader with subscribe-and-reload), so the type is never a placeholder. An application waits for it: BrightRule's source is registered in code today.

**One schema.** The type's one Zod source is `packages/spec/src/ai/knowledge-source.zod.ts#KnowledgeSourceSchema` (Prime Directive #7, ADR-0005). No second schema is written beside it. The type name is `knowledge_source`, singular. The stack collection's name and the file suffix are row 3's; a name in this record is a proposal. Row 3 also gives the type an example in `examples/app-showcase`: that application's kind coverage is driven by the registry and fails on a registered kind with no example (ADR-0088, Consequences).

**"Referencing objects."** An item names one object and fields of that object. It defines no object, extends none, and is refused when the object or a named field does not exist (the lint and `os validate` checks are row 4).

**Authoring a source is an egress decision and a cost decision.** Saving one sends the listed fields of every matching record to the embedding provider on the first build (#37099 puts that cost in the docs) and keeps them in an index. So row 3 lands two guards with the type, each with a pin:

- **A named permission.** Row 3 states which permission admits creating or changing a `knowledge_source` at runtime, the same at every door (Studio, the metadata API, MCP), and pins that a principal without it is refused at each. A grant to read or write the object's records does not imply it.
- **Source admission at save.** The gates of PR #36850 are asked when an item is saved, as the authoring principal, and not only when someone searches. An object whose package is disabled, that the API exposure refuses for search, or that is a system object without `enable.aiReadable`, and a field the author may not query, each refuse the save with a coded refusal that names the object or the field. A packaged item meets the gates that need no principal in `os validate` and at publish (row 4).

**The v1 keys are the keys something enforces.** The right column names the enforcer read at `254e396a29`; "none" means no file under the service or either in-tree adapter reads the key.

| Key today | In v1 | Enforcer |
|:--|:--|:--|
| `id` | renamed `name` (K6) | the registry key, the document id (`packages/services/service-knowledge/src/knowledge-service.ts#documentIdFor`), the `sourceIds` of a search |
| `label`, `description` | kept | the `sources` list of a `search_knowledge` answer (`packages/services/service-knowledge/src/knowledge-tools.ts#SearchKnowledgeSourceSummary`) |
| `adapter` | kept, and optional from row 3 (◆ below) | adapter routing (`packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeService`) |
| `adapterConfig` | kept only while an adapter reads it (below) | `packages/plugins/knowledge-ragflow/src/index.ts#extractRagflowOptions` reads four keys of it (`datasetId`, `rerankModel`, `similarityThreshold`, `vectorSimilarityWeight`); #37004 retires that package |
| `source.kind` | kept, with one arm, `object`; see point 1 below | the discriminator the service branches on |
| `source.object` | kept | the reindex walk, event sync, source admission |
| `source.contentFields` | renamed `content`; `'*'` refused (K5, K6) | `packages/services/service-knowledge/src/knowledge-service.ts#recordToDocument`; `packages/services/service-knowledge/src/knowledge-source-admission.ts#admitSourceFields` |
| `source.metadataFields` | kept | the same two |
| `source.where` | kept | `reindexSource`; event sync once #36991 lands, which row 3 waits for |
| `refresh.onRecordChange` | kept | `packages/services/service-knowledge/src/knowledge-service.ts#objectSourcesFor`, for event sync and the reap guard alike |
| `aiExposed` | kept | the `search_knowledge` executor (K9) |
| `refresh.cron` | removed (K6) | none; the schema's own note says "this slot is parsed and reaches no engine" |
| `embedding`, `vectorStore` | removed (K6) | none |
| `source.kind: 'file'` with `prefix`, `mimeTypes` | not in v1; point 1 below | none |
| `source.kind: 'http'` with `urls`, `userAgent` | not in v1; point 1 below | none |
| (not a key today) `source.split` | added by #37098, before the type lands (K8, item 10) | the splitter that card adds |

- **An unknown key is refused, not dropped.** Today the schema is a plain object, and a parse drops what it does not declare. On a governed type that is a silent no-op (Prime Directive #12).
- **A key added later lands with its first reader**, in the same PR. No key is reserved here.

**▲ Point 1, past the rulings' words — the `file` and `http` shapes are retired, and the push door with them.** The card asks this record for the fate of the two runtime-registration shapes and names the rule ("one strict contract"). It does not name the fate. Three rules that are settled produce one:

- ruling D2 makes the type one that references objects;
- a v1 key needs an enforcer, and none of `prefix`, `mimeTypes`, `urls`, `userAgent` has one. For such a source `reindexSource` answers `ok: false`, and its hits skip the permission re-read (`isNonObjectSourceHit` in the service): the docs call that "the adapter's problem", and no in-tree adapter reads a document's `permissions`;
- one strict contract (Prime Directive #12) leaves no room for a second, code-only source shape beside the governed one.

So the two arms leave `KnowledgeSourceSchema` in the PR that admits the type, with an ADR-0087 disposition (K6). What that costs:

- **A corpus ingested outside the platform** and searched through a registered `file` or `http` source has no form in v1.
- **The push door.** `indexDocument` and `deleteDocument` are the on-platform way to fill such a source. With the arms gone they have no target left, because K1 refuses them on an object source. They leave `IKnowledgeService` in the same PR.
- **Clauses that phase-2 cards build for the two arms** are removed with them: #37103 item 3 ("File and http sources group by `documentId`") and #37097 item 1 ("absent for file / http sources"). They are right while the arms exist.

The package whose README and tests carry the `http` shape, `knowledge-ragflow`, is retired by #37004 whatever the answer here. The arms and the push door return together, as a new arm with a full design (schema, loader, reader, and an answer for permissions) and with the parsing adapter that is its first reader, as ADR-0088 asks of a returning kind. **The approver accepts this with the record or strikes it**; struck, the fate goes back to the maintainer and row 3 waits for it.

**◆ Decided on the contract input (item 11) — `adapter` becomes optional in row 3.** The input leaves this "to this ADR and row 3". Phase 2 keeps the key required (#37102, item 2). From row 3 an item may omit it, and an omitted `adapter` means the deployment's adapter: the one the runtime mounted for its database (#37102: `pgvector` on PostgreSQL, `turso` otherwise), or the only adapter registered. With several registered and none the deployment's, the source is refused at registration and the refusal names the choices. A named adapter that is not mounted stays #37102's error. The reason is the epic's finish line: one source written as metadata must build on `os dev`, on a hosted environment and on PostgreSQL, and a required `adapter` names one store. The change widens what an author may write, so it needs no ADR-0087 disposition. Taking `adapter` off the source altogether was not chosen: it needs a removal row in K6 and leaves a deployment with two stores no way to place a source.

**`adapterConfig` stays only while an adapter reads it.** Its one reader in this tree is `knowledge-ragflow`, which #37004 retires; `knowledge-pgvector` and `knowledge-turso` take their settings as plugin options (#37100, #37107). Row 3 applies the v1 rule to the tree it finds: if no adapter reads `adapterConfig` then, the key does not enter v1 and takes a removal row in K6; if one does, it stays.

**▲ Point 3, past the rulings' words — registration in code stays a door for the same schema.** The epic's phase 2 says sources are still registered in code, and row 3 adds the metadata door. This record reads "one strict contract" as one shape, not one door: `KnowledgeServicePlugin({ sources })` and `registerSource` remain, they take the type's schema and nothing else, and they parse with it (today `registerSource` stores what it is given without a parse). **A name is one source, whichever door it came through**: a registration from one door never replaces a source that arrived through the other. Today `registerSource` overwrites an existing id with a warning. Once a governed item and a code registration can carry one name, that is a silent override of governed metadata, so the second arrival is refused with a coded refusal that names both. A metadata item that reloads its own earlier version is not a second arrival. Row 3 writes the refusal's code and words. Whether the code door is closed once every source can be metadata is not decided here.

### K5 — A source lists its content fields; embedding is egress

Ruling D5: a source lists its content fields explicitly.

- **`content` is a non-empty list of field names of the source's object. `'*'` is refused**, at parse, with a prescription that says to list the fields.
- **Why.** Embedding is egress. The text of every listed field is sent to the embedder, which for most deployments is an external provider, and is stored in an index outside the row store. Today a `'*'` member means every non-empty string value of the record except `id` (`recordToDocument`). A text field added to the object later starts leaving the row store with no change to the source. With a list, what leaves can be read from the source, and a new field does not leave until an author adds it.
- **Everything else a document carries is declared too**: `metadataFields` is already a list, and the title is the object's display field (#36994).
- **No document reaches an object source's index except through assembly.** The push door is refused there (K1), so the list above is the whole of what leaves.
- **What an index never carries is unchanged.** Credential-class and `internal` fields are skipped, even when a source names one.
- **Field egress (cloud ADR-0119, requirement 2).** Assembly is an AI read path. A field the field-egress declaration withholds never enters a document: not as content, not as metadata, not as the title. Assembly is one function, which is one reason it is the platform's and not each adapter's. The declaration itself belongs to another topic and is not designed here: its key, and whether a source that names a withheld field is refused at authoring or the field is skipped at run time, are that record's.
- **Source admission reads the same list.** The `'*'` branch of `admitSourceFields` (PR #36850) goes with the wildcard.

### K6 — ADR-0087 dispositions

The five keys are on the authorable surface today: `packages/spec/authorable-surface/ai.json` lists `ai/KnowledgeSource:id`, `ai/KnowledgeSource:embedding`, `ai/KnowledgeSource:vectorStore`, `ai/KnowledgeRefreshPolicy:cron` and `ai/ObjectKnowledgeSource:contentFields`. Renaming or removing one narrows what an author can write, at whichever door it was written. No stored row carries any of them, because a source has never been stored as metadata.

| From | To | Kind | ADR-0087 disposition |
|:--|:--|:--|:--|
| `KnowledgeSource.id` | `name` | lossless rename; the value is unchanged | a D2 conversion entry that renames the key; a `retiredKey()` tombstone on `id` whose message says to use `name`; a retired-key registry row; part of the major's chain step (D3) |
| `ObjectKnowledgeSource.contentFields` | `content` | rename; lossless for a list of field names; a `'*'` member has no mapping | the same three for the rename. The `'*'` member is the semantic part: the conversion leaves it, the parse refuses it with K5's prescription, and `os migrate meta` reports it as an edit the author makes by hand |
| `KnowledgeSource.embedding` | removed | never read | a conversion that strips the key; a tombstone; a registry row. The prescription: the embedder is configured once for the deployment |
| `KnowledgeSource.vectorStore` | removed | never read | the same. The prescription: the store is the adapter the deployment installs |
| `KnowledgeRefreshPolicy.cron` | removed | parsed, reaches no engine | the same. The prescription: schedule `reindexSource` from a flow or a job; periodic correctness is reconcile's (row 15) |

Three more changes ride the same PR, each on a condition this record names elsewhere:

- **If point 1 is accepted**, the `file` and `http` arms and their four keys retire as one more family. They have no mapping: nothing read them, so there is nothing to convert them to. `indexDocument` and `deleteDocument` leave `IKnowledgeService` with them. Those two are a published TypeScript interface with no metadata surface, which ADR-0087 D7 calls compiler-carried: the changeset names them under `runtime-interface-only` and no ledger entry is owed.
- **If no adapter reads `adapterConfig` when row 3 lands** (K4), it is a sixth removal, by the same kit as `embedding`.
- **`adapter` becomes optional** (K4, ◆). That widens what an author may write and takes no disposition.

1. **All of it lands in row 3's PR, with the type**, as the epic's row states. That PR's changeset carries `Metadata-protocol: narrowed` (it adds a type and narrows keys, and `narrowed` wins over `added`), the `(narrowing)` arm on its `Clause-②:` line, a BREAKING banner, the FROM → TO table above, and one ADR-0087 marker that names registered entries. On a declared narrowing the `not-required (no-migration-prescription)` category is refused, so the family is a registered semantic entry (ADR-0087 D3: one entry per retirement family).
2. **No stored-row ceremony.** Nothing is stored.
3. **Every door runs the same kit.** A source reaches the service through the stack collection (from row 3) and through registration in code (point 3). Neither door keeps an alias of its own (Prime Directive #12): the code door either runs the same conversion entries or refuses with the tombstone's prescription, and row 3 states which, with a pin. The compiler is the third channel: a tombstone types its key `never`, so a TypeScript registration that still writes `id` or `contentFields` does not compile. ADR-0087 D7 is the other reading of the code door's half: a change to a published TypeScript surface that has no metadata surface is compiler-carried and owes no ledger entry. It stops applying to these keys once the same shape is a metadata type's schema, which is what row 3 makes it; row 3 says which reading it uses for registrations in code, and why.
4. **A rename changes no value.** Document ids, which are built from the source's name and the record id, do not change, so no rename forces a rebuild; and a fingerprint is computed over values, never over key spellings, so no rename starts a generation (K7).
5. **Nothing else is renamed.** The `sourceIds` argument and the `sources[].id` member of `search_knowledge`, and `sourceId` on a document and on a hit, are tool and document shapes. They carry the source's name and keep their spelling.
6. **First-party instances move in the same PR or its paired teaching card (row 5b)**: `content/docs/protocol/knowledge.mdx`, `content/docs/ai/knowledge-rag.mdx`, the package READMEs, the service's tests, and `skills/objectstack-ai`, which teaches `contentFields` and the `*` member today. `knowledge-turso` is in this repository by then (#37107) and moves with them. Outside this repository: BrightRule's registration.
7. **This record fixes the dispositions, not the file list.** Which kit files and generated baselines move is the retirement kit's own contract and its gates'.

### K7 — One index fingerprint; a changed fingerprint is a new generation

The index of a source has **one fingerprint**. The service computes it, in one function, and hands it to the adapter on every call (K8, item 8). Five components:

| Component | What it is | Where it comes from |
|:--|:--|:--|
| Embedding model | the identity of the model whose vectors the index holds, together with any option of the adapter that changes the vectors it stores (a document-side prefix, a normalisation) | the adapter's embedding descriptor (K8, item 6): what the adapter reports for the embedder it calls |
| Dimensions | the width of those vectors | the same descriptor |
| Split configuration | the values that cut the text: the strategy and the resolved `maxChars` and `minChars` | the splitter, after it has combined the source's `split`, the settings fallback and the embedder's limit (#37098) |
| Split algorithm version | a constant the splitter exports; it changes when the splitter gives different passages for the same text and settings | the splitter |
| Content recipe | what assembly reads to build the text of a document (point 2 below) | the source and the assembly function |

- **Whose embedder.** K1 gives the embedding calls to the adapter, and an adapter may call the platform's embedder service, an embedder it was built with, or an engine that embeds inside itself. So the first two components are always what the adapter reports, for every adapter. The service never reads them from the deployment's settings around the adapter.
- **The split that was applied, not the split that was written.** #37098 resolves `maxChars` as the smaller of the configured value and a share of the embedder's limit, with a settings key beneath the source's own. A changed setting or a changed limit changes the passages, so the resolved values are what is hashed.

**A changed fingerprint means a new generation.** A generation is one complete index of one source under one fingerprint.

1. **Generations never mix.** Every stored passage belongs to one generation. Vectors of two models, or passages of two splits, are never ranked against each other.
2. **The adapter owns its generations**: their tables, the lock that keeps one builder per source, the switch and the deletion of the old one (the input's item 16). The contract carries three things only: the fingerprint the service expects, what the adapter holds, and the end of a complete build (K8, item 8).
3. **A mismatch is refused on a write.** A write whose fingerprint differs from the active generation's goes to a generation under construction, or is refused when there is none. It is never written into the active generation.
4. **A mismatch is refused on a search.** A query embedded by today's model cannot be ranked against yesterday's vectors; that is the same mixing. A search whose fingerprint differs from the active generation's is refused with a coded refusal (ADR-0112) that says the source needs a rebuild, or is being rebuilt (#37100, #37101). It is never answered from the other generation. And the service does not turn it into an empty answer: today `search` logs an adapter failure and goes on, and the tool tells the model that no passage means nothing matched.
5. **The fingerprint is computed over values, in a fixed order, and pinned by a test.** The same source and the same adapter give the same fingerprint on every machine. A key rename changes no value and so no fingerprint (K6).
6. **The fingerprint is derived, never authored.** No key on a source sets it.
7. **An adapter that reports no embedding descriptor** gives the fingerprint no model and no dimensions, so a change of either cannot be seen for it. That is acceptable for `knowledge-memory`, whose index does not outlive the process. A store that persists reports one.

**What starts a rebuild.** The service reads what the adapter holds (K8, item 8) at boot (#37099) and when a source's definition is reloaded (row 3), and acts on one of three states:

| What the adapter holds | What the service does |
|:--|:--|
| nothing | builds the source (#37099) |
| a fingerprint that differs from the current one | builds a new generation (#37099 starts it; #37101 and #37107 build and switch) |
| the same fingerprint and a different **recipe hash** | runs one complete rebuild inside the same generation |

**The recipe hash** is the trigger for the third state. It is a second hash, computed by the service over what assembly reads and the fingerprint leaves out: the source's `where`, its `metadataFields`, the title rule, and which of the source's fields an index may not carry as that resolves now (credential-class, `internal`, and withheld by the field-egress declaration once that exists). The adapter stores it beside the fingerprint and records it only at the end of a complete build. The rebuild it starts is an ordinary complete `reindexSource`: #37096's document hash skips what did not change, a changed document is written again, and the purge removes the ones that left `where`. Search keeps answering meanwhile, because the vectors are comparable; #37103's freshness check drops a hit whose record left `where` or whose document hash moved. Without this hash, a field taken out of `metadataFields` or newly withheld from egress would stay in the index and in hits until someone rebuilt by hand.

**▲ Point 2, past the rulings' words — what "content recipe" covers.** The card names the component and does not define it. This record reads it as: the object, the ordered `content` list, and the version of the assembly rule (how the listed values become one text). It leaves `where` and `metadataFields` to the recipe hash, for this reason: the fingerprint answers one question, whether a vector stored yesterday may be ranked against a vector computed today, and neither of those two changes a vector. The other answers put one or both into the fingerprint. That needs no recipe hash for them, and every such change then re-embeds the whole source. The approver accepts this reading with the record or strikes it.

### K8 — The contract additions, decided item by item

The epic holds the contract shut until this record merges ("No new adapter-contract members before #37001 merges"). The maintainer session's comment `7142505760` on #37001 lists what the phase-2 cards propose and says "the ADR decides the final shapes". The table answers its sixteen items in its order. **This record adds no member**: the PR that lands it changes no file under `packages/`.

| # | The input's item | Decision | Final shape and meaning | First reader |
|:--|:--|:--|:--|:--|
| 1 | `IKnowledgeAdapter.listDocuments?` | Accepted | `listDocuments?(ctx, { cursor?, limit })` answers `{ documents, nextCursor? }`, each entry `{ documentId, docHash? }`. It lists the generation that writes go to. An entry with no `docHash` reads as changed. A document written while a listing runs may be missing from it; that is the safe direction, because a missing entry is never a purge candidate. An adapter without the method: no skip and no purge, and the result says `purged: null`. | #37096; row 15 reuses it |
| 2 | `KnowledgeDocument.docHash?` | Accepted | A hash of the assembled document (content, title, metadata; stable key order; a version prefix), computed by the service, stored by the adapter, returned as stored. | #37096 |
| 3 | `KnowledgeHit.docHash?` | Accepted | The stored hash of the hit's document. | #37103 (the freshness check) |
| 4 | `IKnowledgeAdapter.dropSource?(ctx)` | Accepted, deferred | Removes everything the adapter holds for the source, every generation. Not in phase 2. | row 3 (a removed source) |
| 5 | The chunk channel | Accepted; shapes ◆ | `KnowledgeDocument.chunks?`, a list of `KnowledgeChunk`. `packages/spec/src/ai/knowledge-document.zod.ts#KnowledgeChunkSchema` is reshaped, not duplicated: `id` (the service sets it to the document id, `#`, and the index, so a hit's `chunkId` is the same on every adapter), `documentId`, `index`, `content`, and a new `headingPath?`, a list of heading texts, outermost first. Its `metadata` key has no producer and no reader today; #37098 gives it one or removes it (ADR-0049). The flag is `capabilities?: { chunks?: boolean }` on the adapter; an adapter that does not declare it keeps receiving whole documents. | #37098; `knowledge-memory` declares the flag there, then #37100 and #37107 |
| 6 | The adapter reports its embedder's limit; `IEmbedder.maxInputTokens?` | Accepted; shape ◆ | The adapter's embedding descriptor, `embedding?`, with `model?`, `dimensions?`, `maxInputTokens?` and `variant?` (an opaque string for an option that changes the vectors the adapter stores). The service reads it when it needs it and never keeps an answer taken during `init`, because the embedder may register later. `IEmbedder.maxInputTokens?` is added so that an adapter can fill the descriptor from the embedder it calls. | #37098 reads `maxInputTokens`; #37100 reads the other three, for the fingerprint |
| 7 | `IEmbedder.model?` | Accepted | The model's identity as the provider names it. `IEmbedder.id` stays what it is, a label for logs. | #37100, #37107 |
| 8 | How the fingerprint reaches the adapter | Accepted; shape ◆, and wider than the input's words | Three parts. (a) `AdapterContext.index?`, carrying `fingerprint` and `recipeHash`, and `AdapterSearchOptions.index?`, carrying `fingerprint`: what the service expects, on every call. (b) `indexStatus?(ctx)` answers what the adapter holds for the source: `fingerprint?`, `recipeHash?`, `building?`. (c) `completeBuild?(ctx)`: the service calls it once, after a complete walk and its purge; the adapter records `ctx.index` as what it holds and, if it built a new generation, makes it active. Parts (b) and (c) are not in the input's words. They are here because #37099's "adapter marks it as needing a rebuild" and #37101's "When the walk ends" step cannot be built without them. | (a) #37100 and #37107; (b) #37099; (c) #37101 and #37107 |
| 9 | `KnowledgeDocument.organizationId?`, `AdapterSearchOptions.organizationIds?` | Accepted | The first is set by the service at assembly. The second is the caller's organizations, by the deployment's posture. The adapter filters by it before it ranks. The permission re-read stays the access decision. | #37097 (`knowledge-memory` first), then #37100 and #37107 |
| 10 | Where the `split` key lives | Decided ◆ | On the object arm, beside `content`: `source.split?`, with `strategy` (one of `whole`, `recursive`, `markdown`), `maxChars?` and `minChars?`. It says how this object's documents are cut, so a later arm brings its own. A source key, not a contract member. | #37098 |
| 11 | Whether `adapter` becomes optional | Decided ◆ | Optional from row 3; required through phase 2 (K4). | row 3; #37102 keeps it required |
| 12 | The capability token `knowledge` | Accepted | A platform capability token: an application that lists it under `requires` gets the knowledge service mounted. From row 3 a `knowledge_source` item mounts it too. Kernel vocabulary, not a contract member. | #37102 |
| 13 | Grouping inside the adapter | Not accepted now | The service groups (K1). It returns by a dated note here, with an adapter that can group in SQL as its reader. | none yet; #37103 groups in the service |
| 14 | `KnowledgeHit.headingPath?` | Accepted | The heading path of the chunk the hit came from, in the chunk's shape. | #37103 |
| 15 | The query prefix for asymmetric models | Decided ◆: no member | The adapter embeds, so it knows a query from a passage and applies a prefix itself, by an option of its own (`queryPrefix`, #37100). An option that changes stored vectors goes into the descriptor's `variant` (item 6). An `inputType` argument on `IEmbedder.embed` returns by a dated note, with the first embedder whose provider has to be told. | #37100 (the option) |
| 16 | `knowledge-turso` | Accepted as a rule | No member beyond items 1, 5, 7, 8 and 9. Its generation table and lock row stay inside the adapter (K7, rule 2). | #37107 |
| 17 | (not in the input) A typed scope filter | Deferred | A typed form for what is an opaque `filter` record on `AdapterSearchOptions` today, built by the service from `scope: [{ object, ids }]`. | row 11 |

**What "capabilities" became.** #36990's rule named "capabilities" among the members that waited for this record. Two things answer it. A method that is absent is the capability signal for listing, dropping, status and completion: the service asks whether the method is there. One flag covers what a method cannot say, `capabilities.chunks` (item 5). No wider descriptor is added.

**What counts as a member** (for rule 5 below, and for the epic's "no new adapter-contract member"). A member is anything an adapter author must read to be correct:

- a method or a descriptor on `IKnowledgeAdapter`, and a key on `AdapterContext` or `AdapterSearchOptions`;
- a key on `KnowledgeDocument`, `KnowledgeChunk` or `KnowledgeHit`, because an adapter stores, reads or returns it: `docHash`, `chunks`, `headingPath` and `organizationId` are members;
- a key on `IEmbedder`: `model` and `maxInputTokens` are members.

Not members, so they land with their reader under ADR-0049 and need no line here: options and results of `IKnowledgeService` (`granularity` and `groupBy` in #37103, `scope` in row 11, and `skipped`, `purged`, `failed`, `failures` on the reindex result in #37096 and #37098); source keys, which K4 governs; settings keys (#37098, #37104); capability tokens; an adapter's own plugin options; and whatever an adapter keeps inside its store.

Rules for every member:

1. **A member lands with its first reader, in the same PR**, and with a case in the contract test suite. #37096 creates that suite and exports it from `service-knowledge`. `knowledge-memory` runs it there, `knowledge-pgvector` in #37100 and `knowledge-turso` in #37107. `knowledge-ragflow` is not held to it: #37004 retires it.
2. **Every member is optional.** An adapter written before this record keeps working, and where it lacks a member the service does what it does today for that part and says so where a result or a log can carry it (#37096's `purged: null`). Nothing is skipped silently.
3. **The shapes in the table are the decided ones.** A reader card that finds one cannot be built as written stops and says so on its card; the change is a dated note on this record.
4. **The contract carries what an adapter reports, never how it is configured.** The descriptor of item 6 is a report. Which provider, which key, how to batch, hybrid weights, rerank toggles and parser options stay in the adapter's own plugin options.
5. **The list is closed.** A member that is not in the table needs a dated note on this record first.

### K9 — One `search_knowledge` definition, and every knowledge tool goes through the tool registry and the MCP seams

**What landed** (PR #36823, merged as `8aecf6d770`, read in the tree at `254e396a29`). The tool has one definition, `packages/services/service-knowledge/src/knowledge-tools.ts#getKnowledgeToolDefinitions`, and one executor, bound by `packages/services/service-knowledge/src/knowledge-tools.ts#createKnowledgeTools`. The knowledge service hands both out through `knowledgeTools()`. Both MCP transports register that definition and call that executor as the principal they bind, where the grant admits `data:read` (`packages/mcp/src/mcp-http-tools.ts#registerKnowledgeTools`; the HTTP bridge in `packages/runtime/src/domains/mcp.ts`, the stdio bridge in `packages/mcp/src/stdio-data-bridge.ts`).

`aiExposed` is enforced in that executor. The module note reads: "The tool enforces it HERE, in its executor, for every call: the sources it searches are the registered sources whose `aiExposed` is not `false`, and a `sourceIds` entry naming any other id, an unexposed source included, is refused `NOT_FOUND` with the same sentence an unknown id gets". And: "`IKnowledgeService.search` itself keeps searching an explicitly named source whatever its `aiExposed`: that service also serves the platform's own callers, which are not agents".

**The rules.**

1. **One definition for every transport** (ADR-0149 D2). The in-app agent registers the same definition and delegates to the same executor (objectstack-ai/cloud#4933, the epic's row 13). The epic's finish line is that the MCP door and the in-app agent serve byte-identical definitions.
2. **A new argument enters that one definition.** `scope`, `granularity` and `groupBy` arrive in row 12, after their readers in the service (#37103 and row 11). No transport adds an argument of its own.
3. **`aiExposed` stays at the tool layer.** It says what the agent tool may expose. It is not moved into `IKnowledgeService.search`, whose signature and return type do not change.
4. **Every knowledge tool is an ordinary tool call through the tool registry and the MCP tool seams** (cloud ADR-0119, requirement 1). No knowledge capability reaches a model any other way: no REST route built for a model to call, no adapter called from an agent runtime, no retrieved text placed in a prompt by a side path. A PR that adds one is refused in review. This is what lets the Enterprise interceptors apply with no new code.
5. **The tool adds no permission and removes none** (ADR-0090 D10). Every call reads as the caller.
6. **The number of hits the permission filter removed is never returned to the caller.** It goes to logs only.

Two cloud notes, carried so that they are not lost: `search_knowledge` needs no narrowing change (comment `7136912027`), and the test that a narrowed AI identity gets no hit from an object outside its grant belongs to the epic's row 14 (comment [`7136687401`](https://github.com/objectstack-ai/objectstack/issues/37000#issuecomment-7136687401) on #37000).

### K10 — What this record does to other records, and the rules every child carries

- **No record in this registry is amended.** The old position was never an ADR here: it lived in #4606, in the docs and in code notes (K2, K3). So no other record's Status line gains a pointer.
- **ADR-0088** is applied, not amended (K4). **ADR-0087** is applied (K6). **ADR-0149 D2** is applied to a third tool (K9). **`ADR-0057-system-data-lifecycle-and-retention`** is untouched: the reap guard stays.
- **Cloud ADR-0119** is the commercial half of this record ([Provenance](#provenance)). **Cloud ADR-0025** is untouched: the in-app assistant that uses knowledge stays closed.

The epic's "Rulings that bound every child" are carried here, so that a child reads them in one place:

1. A key lands with its first reader in the same PR (ADR-0049). No type and no key ships without its enforcer.
2. No new adapter-contract member before this record merges; after it, only the members K8 accepts, each with its reader.
3. Answers read content as the asking user. The index copy is for ranking and snippets only.
4. The count of hits removed by the permission filter is never returned to the caller.
5. Embedding is egress: a source lists its content fields explicitly (K5).
6. One `search_knowledge` definition for every transport, and `aiExposed` stays enforced at the tool layer (K9).

---

## Execution (after acceptance)

The children are the epic's, in its layout as it stands after the phase-2 cards were filed (2026-11-24). ⛔ The session that wrote this record files none of them. The table says which part of this record each card or row carries.

| Phase | Card or row | Work | Carries |
|:--|:--|:--|:--|
| 1 | #36991, #36992 (#36995 is closed) | event sync honours `where`; paged reindex; embedder batches | nothing of this record; they add no member |
| 2 | #37093, #37094, #37095, #36993 | over-limit input refused; the open edition registers the embedder service; CI image with pgvector; refill after the permission filter | no member; they do not wait for this record |
| 2 | #37096 (row 2) | `listDocuments`, the document hash, the purge, the contract suite | K1 (the purge half of reconcile); K8 items 1 and 2 and rule 1; the first texts of K2 |
| 2 | #37097 | documents carry their organization | K8 item 9 |
| 2 | #37098 (row 6) | the splitter, the chunk channel, the `split` key | K1 (split); K8 items 5, 6 and 10; K7's split components |
| 2 | #37099 | a never-built source is built; the operator's rebuild | K7's three states and the recipe hash; K8 item 8 (b). With that member the card waits for this record, which its `Blocked-by` line does not say today |
| 2 | #37100 (row 8a) | `knowledge-pgvector`: tables, exact search, listing, chunks | cloud ADR-0119 D5; K7 rules 3 and 4; K8 items 7, 8 (a) and 15 |
| 2 | #37101 (row 8b) | a changed fingerprint builds a new generation | K7 rules 1 and 2; K8 item 8 (c) |
| 2 | #37107 (row 7, moved up) | `knowledge-turso` moves here | cloud ADR-0119 D5; K8 items 1, 5, 7, 8 and 9, and item 16's rule |
| 2 | #37102 (row 9) | `requires: ['knowledge']` mounts the service and a store by database | K8 item 12; `adapter` stays required here (item 11) |
| 2 | #37103 (row 10) | records, not chunks: `granularity`, `groupBy`, the freshness check | K1 (record-level return); K8 items 3 and 14; item 13 stays out |
| 2 | #37104; #37004 | every knowledge setting gets a reader or goes; `knowledge-ragflow` is retired | no member. #37004 decides whether `adapterConfig` still has a reader at row 3 (K4) |
| 3 | row 3 | the `knowledge_source` type with its loader | K4 with its two guards, its example and the one-name rule; K5; K6; K8 items 4 and 11; the push door (K1). Points 1 and 3 stand as merged or as struck |
| 3 | rows 4, 5, 5b | lint and `os validate` checks; the Studio form; the skill and the MCP authoring schema | K4's reference checks and the gates that need no principal; K6 item 6 |
| 3 | rows 13, 14 | cloud: the in-app agent registers the shared definition; the hosted kernel registers the service | K9 rules 1 and 4 |
| 3 | rows 11, 12 | the scope filter; the tool's new arguments | K8 item 17; K9 rule 2 |
| 4 | row 15, and the sync-failure counts | sync through the queue; the daily reconcile | K1 (reconcile), reusing #37096's purge and K8 item 1 |
| 4 | #36994 | the hit's title from the display field | K5 (the title is declared) |

---

## Points the rulings do not settle

**▲ Three points are the maintainer's.** The card's seven items, the maintainer's words, the contract input and cloud ADR-0119 do not settle them. Each is written above as this record's reading, outside every ruled block. Merging the record accepts them; any of them can be struck first.

| # | Point | What this record writes | The other answers |
|:--|:--|:--|:--|
| 1 | The fate of the `file` and `http` shapes, and of the push door (K4, K1) | both arms retire with the type's admission, and `indexDocument` and `deleteDocument` leave with them; all return as one designed arm with a parsing adapter | keep one key-less arm for a corpus an external engine ingests, with the push door as its write door; or keep the two shapes as code-only registrations, which is a second contract |
| 2 | What "content recipe" covers in the fingerprint (K7) | the object, the ordered `content` list, the assembly rule's version; `where` and `metadataFields` go to the recipe hash and are repaired inside the generation | put `metadataFields`, or `where` too, into the fingerprint: no recipe hash for them, and a full re-embedding on every such change |
| 3 | Registration in code after the type lands (K4) | stays, as a second door for the one schema; one name is one source | closed once every source can be metadata |

**◆ These are decided here, on the contract input** (comment `7142505760`: "the ADR decides the final shapes"). They are listed so that the approver sees each choice in one place.

| The input's item | What this record decides |
|:--|:--|
| 5 | the chunk's final keys, with the service setting its `id`; the flag is `capabilities.chunks` |
| 6 | one embedding descriptor on the adapter (`model`, `dimensions`, `maxInputTokens`, `variant`), read at use |
| 8 | three parts: the expected fingerprint and recipe hash on every call, `indexStatus`, `completeBuild`. The last two and the recipe hash go past the input's words |
| 10 | `split` lives on the object arm, as `source.split` |
| 11 | `adapter` becomes optional in row 3; an omitted one means the deployment's adapter |
| 13 | no grouping member now |
| 15 | no query-prefix member; an adapter option |
| (the review's finding on the push door) | `indexDocument` and `deleteDocument` are refused on an object source |

---

## Consequences

- **An author declares what is searchable in one place**, as metadata that ships with the application, and the fields that leave the row store can be read from that declaration.
- **One source gives the same passages on every adapter that takes chunks**, which is every adapter this repository ships. Changing the adapter changes how candidates are found and ranked, not what is indexed.
- **The adapter contract grows by optional members.** An adapter written before this record keeps working with today's behaviour. The three adapters this repository ships run one suite.
- **Row 3 is a breaking change for anyone who registers a source in code**: five keys, the two arms and the push door if point 1 stands, and `adapterConfig` if nothing reads it by then. BrightRule's registration and `knowledge-turso` change with it. The compiler and the tombstones name each edit.
- **A change of embedding model, of dimensions or of the applied split is a full rebuild of every affected source**, and a search of such a source is refused until the rebuild ends. That is the price of never ranking vectors of two models against each other. A change of `where`, of `metadataFields` or of what a field may carry costs one walk and no re-embedding of unchanged text.
- **A stored fingerprint and recipe hash are the only index state the service relies on.** The service keeps none of its own; an adapter that stores neither can only tell an empty index from a built one.
- **Authoring a source at runtime needs a permission of its own and passes source admission at save.** A source that would be refused for every caller is refused when it is written, not found empty when it is searched.
- **Index-time work moves into the service.** Splitting, paging and reconcile are the platform's cost now, which is why the queue (row 15) follows.
- **`EmbeddingModelSchema` and `VectorStoreSchema` lose their only composer** when `embedding` and `vectorStore` leave the source. Whether they stay is row 3's finding under ADR-0049 and is not decided here.
- **Some phase-2 cards change with this record.** #37099 gains a member and so waits for this record; #37103 and #37097 carry clauses for the `file` and `http` arms that row 3 removes if point 1 stands; #37101's search-during-build refusal becomes K7's rule 4 for every adapter. The cards' texts are the epic owner's to update.
- **The docs stay as they are until the children land** (K2). For that time the opening sentence of the protocol page states a position this record has replaced.
- **The cloud record owes a pointer to this number** ([Provenance](#provenance)).

## Alternatives considered

- **Keep #4606's posture**: the contract in the core, engines by integration, nothing added. Not taken: ruling D1.
- **Put the recipe on the object**, as an AI or knowledge key of the object. Refused by ruling D2.
- **Leave the split to each adapter, with a shared helper they may call.** Not taken: ruling D1 gives the split to the platform, and the fingerprint needs one algorithm version, not one per adapter.
- **Keep `'*'` and warn.** Refused by ruling D5.
- **Add the contract members in this record's PR.** Not taken: a member lands with its first reader (ADR-0049), and this PR's surface is `docs/adr/` alone.
- **Keep `KnowledgeSource` as a runtime registration and add a metadata type that wraps it.** Not taken: two schemas for one thing (Prime Directives #7 and #12).

## Readings, taken at `254e396a29`

Each text this record quotes was read on `objectstack-ai/objectstack` `main` at `254e396a29`. The rows added for the contract section (the last eight) were read at `b49a264a10`, the `main` this record's branch has merged; no file in this table differs between the two commits. The numbers are a dated reading for the card, not anchors; the decision text cites symbols and files.

| File | What was read | Position at `254e396a29` |
|:--|:--|:--|
| `content/docs/protocol/knowledge.mdx` | the opening, "ObjectStack does not ship its own RAG engine." | lines 7 to 10 |
| same | §1, "We have nothing distinctive to add to those layers." | line 45 |
| same | §1, "The protocol scopes the framework's responsibility to (1)–(4)" | lines 60 to 61 |
| same | §3.1, "It is stored as metadata (versioned, environment-scoped)" | lines 111 to 113 |
| same | §3.2, "The framework does **not** chunk; adapters do." | lines 162 to 163 |
| same | §3.4, "The adapter surface is **deliberately minimal**" | lines 217 to 220 |
| same | §5, a `'*'` member "meaning every field the object declares except `id`" | lines 310 to 311 |
| same | §5, sensitive fields go in a separate source | lines 322 to 324 |
| same | §6, "that surface stays unbuilt until a real `object` source calls for it" | lines 397 to 399 |
| same | §7, the `knowledge-pgvector` row; §8, `KnowledgeSource.embedding` | line 430; lines 449 to 452 |
| `content/docs/ai/knowledge-rag.mdx` | "File / HTTP hits pass through (ACL is the adapter's problem)"; "Why we did not build a vector DB" | line 78; line 82 |
| `packages/spec/src/ai/knowledge-source.zod.ts` | the class note, "the shape of a **runtime registration**, ⛔ not a governed metadata type" | lines 104 to 123, the sentence at 105 to 106 |
| same | `contentFields` and its `*` note; the `file` arm; the `http` arm | lines 63 to 67; 80 to 87; 89 to 96 |
| same | the `cron` note, "this slot is parsed and reaches no engine"; `id`; `embedding`; `vectorStore`; `aiExposed` | lines 36 to 37; 125 to 126; 140 to 144; 145 to 149; 159 to 160 |
| `packages/spec/src/ai/embedding.zod.ts` | the file note, "NOT in scope" and "These were removed in v1" | lines 15 to 23 |
| `packages/spec/src/contracts/knowledge-adapter.ts` | "The surface is **deliberately minimal**"; the interface | lines 18 to 20; 56 to 74 |
| `packages/spec/src/ai/knowledge-document.zod.ts` | the file note; the chunk note; `permissions` | lines 10 to 13; 53 to 57; 45 to 50 |
| `packages/spec/src/contracts/embedder.ts` | `IEmbedder` | lines 26 to 39 |
| `packages/spec/authorable-surface/ai.json` | the five keys of K6 | lines 239, 245, 246, 250 and 322 |
| `packages/spec/src/data/ai-read-exposure.ts` | "**Any other object** is refused" | lines 32 to 37 |
| `packages/services/service-knowledge/src/knowledge-service.ts` | the class note, "Non-responsibilities (the parts plugins own)" | lines 88 to 89 |
| same | `registerSource`, no parse; `reindexSource`, with its `file` and `http` answer, its one `find` and its one `upsert` | lines 123 to 131; 161 to 219, with 168 to 178, 192 to 196 and 210 to 212 |
| same | `search`; `handleRecordUpsert`; `objectSourcesFor`; `documentIdFor` | lines 235 to 280; 290 to 304; 550 to 557; 560 to 562 |
| same | `recordToDocument`, with the `'*'` branch and the title | lines 578 to 615, with 591 to 595 and 612 |
| `packages/services/service-knowledge/src/knowledge-service-plugin.ts` | the three deferral comments of K3 | lines 250 to 260; 296 to 299; 312 to 321 |
| `packages/services/service-knowledge/src/knowledge-tools.ts` | the `aiExposed` note; the definition; the executor | lines 22 to 33; 148 to 160; 246 to 284 |
| `packages/services/service-knowledge/src/knowledge-source-admission.ts` | `admitSourceFields` | from line 228 |
| `packages/plugins/knowledge-memory/src/index.ts` | the paragraph split with a soft 800-character cap | lines 17 to 18, and 104 |
| `packages/plugins/knowledge-ragflow/src/index.ts` | `extractRagflowOptions`; one chunk per document | lines 67 to 85; 113 to 139 |
| `packages/mcp/src/mcp-http-tools.ts` | `registerKnowledgeTools` and its call | lines 3514 and 3182 |
| `packages/runtime/src/domains/mcp.ts` | the knowledge seam under `data:read` | lines 262 to 271 |
| `packages/spec/src/contracts/knowledge-service.ts` | `indexDocument` and `deleteDocument` on `IKnowledgeService` | lines 93 and 95 |
| `packages/services/service-knowledge/src/knowledge-service.ts` | `indexDocument` and `deleteDocument` hand the caller's document to the adapter | lines 147 to 157 |
| same | in `search`, an adapter failure is logged and the search goes on | lines 270 to 274 |
| same | `isNonObjectSourceHit`, and the two places that pass such a hit without a re-read | lines 526 to 529; 480 and 515 |
| `packages/spec/src/contracts/knowledge-adapter.ts` | `AdapterContext`; `AdapterSearchOptions` with its opaque `filter` | lines 31 to 38; 41 to 50, `filter` at 47 |
| `packages/spec/src/ai/knowledge-document.zod.ts` | the keys of `KnowledgeChunkSchema`: `id`, `documentId`, `index`, `content`, `metadata` | lines 58 to 69 |
| `packages/plugins/knowledge-ragflow/src/index.ts` | the four `adapterConfig` keys the adapter reads | lines 50 to 58 and 67 to 85 |
| `packages/spec/src/kernel/platform-capabilities.ts`; `packages/services/service-settings/src/manifests/knowledge.manifest.ts`; `examples/app-showcase/src/coverage.ts` | `PLATFORM_CAPABILITY_TOKENS`; the `chunk_target` and `chunk_overlap` settings; `KIND_COVERAGE` | from line 31; lines 105 to 112; line 52 |

Readings that are counts: no file under `packages/services/service-knowledge/src`, `packages/plugins/knowledge-memory/src` or `packages/plugins/knowledge-ragflow/src`, tests aside, reads `prefix`, `mimeTypes`, `urls`, `userAgent`, a source's `embedding` or `vectorStore`, `refresh.cron`, or a document's `permissions` (0 matches each; the controls `adapterConfig` and `contentFields` match 3 and 6 times in the same three directories). `indexDocument` and `deleteDocument` have no caller outside their declaration and their implementation, tests aside (0 matches), and `KnowledgeChunkSchema` has no reader (its one other mention is a type-alias pin). Nothing under `examples/` registers a knowledge source: 0 matches for `KnowledgeServicePlugin`, against 38 files that match the control `defineStack`; `examples/app-todo` lists the two knowledge packages as dependencies and imports neither.

Readings from the tracker: the contract input is comment `7142505760` on #37001, and the cards it names (#37096 to #37103 and #37107) were read in full, with the epic's body as it stands after its phase-2 rewrite. The retirement of `knowledge-ragflow` is card #37004 and ruling `7134290286` on #36839. #4606 has no comment, and its judgements are in its body. The ruling on #4672 is comment `5194621834`; it was relayed by the services lane's PM and names the maintainer. The 2026-11-15 words are in the body of #33933 and are restated in comment `7134104071`.

## Refs

- Card: [#37001](https://github.com/objectstack-ai/objectstack/issues/37001), with the contract input `7142505760`. Phase-2 cards that read this record: #37096, #37097, #37098, #37099, #37100, #37101, #37102, #37103, #37107; beside them #37093, #37094, #37095, #37104 and #37004 (ruling `7134290286` on #36839). Epic: [#37000](https://github.com/objectstack-ai/objectstack/issues/37000), with records `7135335668` and `7136687401`.
- Cloud: cloud ADR-0119 (objectstack-ai/cloud#4960, merged through objectstack-ai/cloud#4968 as `0aa3c54`), as reported in comments `7136374724` on #37001 and `7136912027` on #34830. Cloud cards named by those comments: objectstack-ai/cloud#4933, objectstack-ai/cloud#4969, objectstack-ai/cloud#4970.
- Superseded positions: [#4606](https://github.com/objectstack-ai/objectstack/issues/4606); [#4672](https://github.com/objectstack-ai/objectstack/issues/4672) (ruling `5194621834`, the voided approval `5163029794`, landed as PR #5987); [#33933](https://github.com/objectstack-ai/objectstack/issues/33933) (record `7134104071`, landed as PR #36975).
- Landed work this record reads: PR [#36823](https://github.com/objectstack-ai/objectstack/pull/36823) for #36650 (`8aecf6d770`); PR [#36850](https://github.com/objectstack-ai/objectstack/pull/36850) for #36839 (`7abf25f2c4`). Open: PR [#37075](https://github.com/objectstack-ai/objectstack/pull/37075) for #36991.
- Phase 1 siblings: #36991, #36992, #36993, #36994, #36995. The sibling epic on record context, whose rule on object recipes K4 shares: #36996, with its record card #36997.
- Review folded by this revision: contract review [`7143922684`](https://github.com/objectstack-ai/objectstack/pull/37119#issuecomment-7143922684) on PR #37119 at head `7e71f5451c` (its M1 is K8 and Execution; S1 the push door in K1 and point 1; S2 K7's descriptor, applied split, recipe hash and search-side refusal; S3 the one-name rule; S4 K4's two guards; N1, N3 to N6 where they stand).
- Admission precedent: [ADR-0159](./0159-forms-are-their-own-metadata-type-public-forms-are-form-items-view-is-lists-only.md), landed by PR #36957.
