# ADR-0161: The knowledge platform boundary — the platform owns document assembly, sync and reconcile, structural split and record-level return; adapters own embedding calls, hybrid retrieval, rerank and file parsing; `knowledge_source` is a governed metadata type

**Status**: Proposed — 2026-11-24, written for objectstack#37001 on the maintainer's ruling of that day, 「需要拍板的事项 都同意」, as the card's filing gate records it. `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted** by an authorized approval or the maintainer's merge of the PR that carries it, and is in force from that merge. **This record declares; it implements nothing** — no schema, no contract member, no code, no changeset; every mechanism below lands through a child of the epic [#37000](https://github.com/objectstack-ai/objectstack/issues/37000) ([Execution](#execution-after-acceptance)). It is the **mechanism half** of cloud ADR-0119 ([Provenance](#provenance)). **Four points go past the rulings' words.** Each is marked where it stands and listed in [Points the rulings do not settle](#points-the-rulings-do-not-settle), for the approver to accept with the record or strike.

- **Date**: 2026-11-24
- **Card**: [#37001](https://github.com/objectstack-ai/objectstack/issues/37001) (p2, `area:ai`), a phase 1 child of the epic #37000. Its seven "What" items are this record's required content; [K1](#k1--the-boundary) to [K9](#k9--one-search_knowledge-definition-and-every-knowledge-tool-goes-through-the-tool-registry-and-the-mcp-seams) answer them one by one.
- **Decided by**: the maintainer, 2026-11-24, verbatim and untranslated: 「需要拍板的事项 都同意」. The card's filing gate records what the words were given on. Its line, as the card carries it:

  > Key words: 「需要拍板的事项 都同意」 (D1: platform owns assembly, sync & reconcile, structural split, record-level return; adapters own embedding calls, hybrid retrieval, rerank, file parsing — D2: `knowledge_source` becomes a governed metadata type referencing objects; no recipe on the object — D5: a source lists its content fields explicitly).

  The epic #37000 carries the same words beside 「专题 ② 知识检索平台化 也一起立」, and its start beside 「37000 现在就启动，就是要和你讨论分阶段」 and 「合并，按四阶段改，先立第一阶段的卡」 (record [`7135335668`](https://github.com/objectstack-ai/objectstack/issues/37000#issuecomment-7135335668)).
- **Numbering**: `D1`, `D2` and `D5` in the quoted line number the decision list the maintainer agreed to. Cloud ADR-0119 has its own `D1` to `D6`. This record's decisions are numbered **K1 to K10** so that the three lists never collide; "ruling D1", "ruling D2" and "ruling D5" below always mean the quoted line.
- **The rulings this record executes** (⛔ none is re-opened here): ruling D1, ruling D2 and ruling D5 above; and the epic's "Rulings that bound every child", carried in [K10](#k10--what-this-record-does-to-other-records-and-the-rules-every-child-carries).
- **Supersedes**, each by name in [K3](#k3--what-this-record-supersedes): the three judgements of #4606 and its restart condition; the adapter-list deferral written in `packages/services/service-knowledge/src/knowledge-service-plugin.ts`; the no-reconcile option ruled on #4672; the maintainer's 2026-11-15 words on #33933.
- **Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source per type), [ADR-0049](./0049-no-unenforced-security-properties.md) and [ADR-0078](./0078-no-silently-inert-metadata.md) (a declared key is enforced or it is not declared; a key lands with its reader), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (conversions, tombstones and the migration chain), [ADR-0088](./0088-metadata-kind-admission-and-retirement.md) (the kind admission test), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D10 (an agent reads as the principal it acts for), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (coded refusals), [ADR-0149](./0149-ai-answers-business-questions-through-the-dataset-semantic-layer.md) D2 (one tool definition, one executor, every transport), [ADR-0159](./0159-forms-are-their-own-metadata-type-public-forms-are-form-items-view-is-lists-only.md) (the latest kind admission, followed for the form of K4), and [`ADR-0057-system-data-lifecycle-and-retention`](./0057-system-data-lifecycle-and-retention.md) (the reap guard the knowledge plugin registers).
- **Leaves unchanged**: permission-aware retrieval (every object-source hit is re-read as the caller, and a source is searched for a caller only after the exposure and field-level admission of PR #36850); the reap guard of #4672 as landed; the signature and return type of `IKnowledgeService.search`; the settings shape of #33933 (knowledge settings only where the service is mounted) until the epic's row 9 changes it on purpose; the open AI door, which stays MCP-only (cloud ADR-0119 D4).
- **Inputs**: every code and docs text quoted below was read on `objectstack-ai/objectstack` `main` at `254e396a29`, the commit this record's branch starts from. Positions are in [Readings](#readings-taken-at-254e396a29). PR #36823 and PR #36850 are merged and are in that tree; PR #37075 is open and edits §6 of `content/docs/protocol/knowledge.mdx`, so the §6 quotations may move when it lands.

---

## Provenance

1. **The cloud record.** Cloud ADR-0119, [`docs/adr/0119-record-context-and-vector-stores-open-ai-read-governance-enterprise.md`](https://github.com/objectstack-ai/cloud/blob/main/docs/adr/0119-record-context-and-vector-stores-open-ai-read-governance-enterprise.md) in `objectstack-ai/cloud`, written on card objectstack-ai/cloud#4960. The maintainer approved it on 2026-11-24 (「4968 我批准了，你修改完可以落地」) and it merged that day through objectstack-ai/cloud#4968, merge `0aa3c54`; it is Accepted. It draws the open and closed line for record context and for vector stores. That is a commercial boundary, so by Prime Directive #13 it lives in the cloud registry and is cited from here as `cloud ADR-0119`, never as a bare number.
2. **This file is the mechanism half.** Cloud ADR-0119 names three things it does not decide and leaves to this card: the knowledge adapter contract, the admission of `knowledge_source`, and the splitter. They govern open code in this repository, so this repository carries the record, under its own number. The commercial half stays in cloud and is not restated as a decision here.
3. **Where the cloud facts in this record come from.** The cloud repository was not readable from the session that wrote this record. Every statement about cloud ADR-0119 below is taken from two records on this repository's tracker and from nowhere else:
   - the cloud seat's confirmation, comment [`7136374724`](https://github.com/objectstack-ai/objectstack/issues/37001#issuecomment-7136374724) on #37001, read at the draft head `e4dad2f` before the merge;
   - the maintainer session's notice, comment [`7136912027`](https://github.com/objectstack-ai/objectstack/issues/34830#issuecomment-7136912027) on #34830, written after the merge. It names what changed from the draft: D3 and D11 are quoted verbatim, D6 lists where the Enterprise value sits without committing knowledge features, and `search_knowledge` needs no narrowing change.
4. **The pointer back.** Prime Directive #13 asks that the cloud record gain a one-line pointer to this number. The PR that lands this file cannot write to the cloud repository; the pointer is owed by the cloud lane after this record merges.
5. **Card and epic.** #37001, filed by the maintainer's session under the epic #37000, whose phase tables are the source of the row numbers this record uses ("row 2", "row 6", and so on).

---

## TL;DR

1. **The platform owns four things, for every adapter**: building a document from a record (assembly), keeping the index equal to the source (sync and reconcile), cutting a document into passages by its structure (structural split), and answering a search with records, not loose passages (record-level return). **Adapters own four**: the embedding calls, hybrid retrieval, rerank and file parsing ([K1](#k1--the-boundary)).
2. **The sentence "ObjectStack does not ship its own RAG engine" is retired**, with the other texts that state the old position. Each is rewritten by the child whose code makes the new sentence true, never ahead of it ([K2](#k2--the-texts-this-record-revises)).
3. **Four earlier positions are superseded by name**: #4606, the adapter-list deferral, #4672's no-reconcile option, and the 2026-11-15 words on #33933 ([K3](#k3--what-this-record-supersedes)).
4. **`knowledge_source` is a metadata type.** It references an object and carries the recipe itself; the object carries none. It passes ADR-0088's three clauses, and its v1 keys are only the ones something enforces ([K4](#k4--knowledge_source-is-admitted-as-a-metadata-type)).
5. **A source lists its content fields.** `'*'` is refused: embedding sends text out of the row store, so the source must say which fields leave ([K5](#k5--a-source-lists-its-content-fields-embedding-is-egress)).
6. **Two keys are renamed and three are removed, under ADR-0087**: `id` → `name`, `contentFields` → `content`; `embedding`, `vectorStore` and `refresh.cron` go ([K6](#k6--adr-0087-dispositions)).
7. **One fingerprint per index**: embedding model, dimensions, split configuration, split algorithm version and content recipe. A changed fingerprint is a new generation; an index never mixes two ([K7](#k7--one-index-fingerprint-a-changed-fingerprint-is-a-new-generation)).
8. **The adapter contract grows by a named list**, and each addition lands with the child that first reads it. This record adds no member ([K8](#k8--adapter-contract-additions-each-with-its-first-reader)).
9. **`search_knowledge` has one definition for every transport**, `aiExposed` stays enforced at the tool layer, and every knowledge tool is an ordinary tool call through the tool registry and the MCP seams ([K9](#k9--one-search_knowledge-definition-and-every-knowledge-tool-goes-through-the-tool-registry-and-the-mcp-seams)).
10. **Four points go past the rulings' words**: the fate of the `file` and `http` shapes, whether a source must name its adapter, what "content recipe" covers, and what happens to registration in code ([Points the rulings do not settle](#points-the-rulings-do-not-settle)).

---

## Context

### The position this record replaces

Until 2026-11-24 the recorded position was that knowledge is a plug point and the platform builds no part of retrieval. `content/docs/protocol/knowledge.mdx` opens with "ObjectStack does not ship its own RAG engine." The service class note in `packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeService` lists "Chunking, embedding, vector storage, hybrid retrieval, rerank" as "the parts plugins own". The decision behind those texts is #4606 (2026-08-02), and #4672 and the code comments of the knowledge plugin were written inside its boundary.

### What the code does today

Read at `254e396a29`:

- **Assembly is already the platform's.** `packages/services/service-knowledge/src/knowledge-service.ts#recordToDocument` builds one document per record from the source's `contentFields`, in order, and skips credential-class and `internal` fields. A member `'*'` takes every non-empty string value of the record except `id`. The title is read from a field named `title` (#36994 is the open card).
- **Sync is the platform's, and incomplete.** `handleRecordUpsert` and `handleRecordDelete` of `packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeService` run inline on per-record events. The upsert path builds from the event body and does not read the source's `where` (#36991, PR #37075 open). `reindexSource` reads the whole object in one `find` and upserts it in one call (#36992). It only upserts: a document whose record no longer matches stays in the index, because the adapter contract has no way to list what an index holds.
- **Nothing in the service splits.** Each adapter does what it likes: `knowledge-memory` cuts on paragraph boundaries with a soft 800-character cap, and `knowledge-ragflow` posts each document as one chunk. The same source gives different passages on different adapters.
- **Search returns passages.** `search` returns chunk-level hits, filtered by the caller's permissions and cut at `topK` (#36993 covers the missing refill). Several passages of one record take several slots.
- **The adapter contract** is `upsert`, `search`, `delete` and an optional `healthCheck` (`packages/spec/src/contracts/knowledge-adapter.ts#IKnowledgeAdapter`).
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
| **Document assembly** | A record becomes a document by the source's recipe: which fields are content, which are metadata, what the title is, and which fields an index never carries. One function decides. No adapter builds a document from a record. |
| **Sync and reconcile** | Events keep an index fresh; a reconcile pass keeps it correct. The service decides which documents an index must hold, writes the missing ones and removes the stale ones. A rebuild is paged. |
| **Structural split** | The service cuts a document into passages by its structure and hands the adapter the passages. One splitter serves every adapter, so one source gives the same passages on each. |
| **Record-level return** | A search can answer with records: the passages of one record are grouped, and the caller learns which records matched and by which passages. |

| The adapter owns | What that means |
|:--|:--|
| **Embedding calls** | Turning passages and queries into vectors, through the embedder the deployment configures (`packages/spec/src/contracts/embedder.ts#IEmbedder`). When to call, how to batch, and whether to call at all (an engine that embeds inside itself makes no call) are the adapter's. |
| **Hybrid retrieval** | How vector and keyword scores are blended, which index or scan is used, and how candidates are found. |
| **Rerank** | Whether a second model reorders candidates, and which. |
| **File parsing** | Turning a PDF, a scan or an office file into text. |

**Why the line is here.** The four on the left need facts only the platform has: the object's fields and their protection, the caller's permissions, the record events, and which record a passage came from. The four on the right need none of those, and they are where dedicated engines are better than anything this repository would write.

**What follows from the two lists.**

- An adapter indexes the passages it is handed. It does not read records, does not decide which records belong to a source, does not split a passage again, does not group hits by record and does not check permissions.
- The service does not choose a model, compute a vector, score a candidate, rerank or parse a file.
- The index is a copy for ranking and snippets. An answer reads content as the asking user, through the record tools; this is the epic's rule and K10 carries it.
- The split strategies, their names and their settings belong to the splitter's card (row 6). The epic's row names `whole`, `recursive` and `markdown`, with rules for Chinese, Japanese and Korean text. This record fixes only who owns the split.

### K2 — The texts this record revises

Each text below states the old position. The left column quotes it as it reads at `254e396a29`; positions are in [Readings](#readings-taken-at-254e396a29).

| Text | What it becomes | Rewritten by |
|:--|:--|:--|
| `content/docs/protocol/knowledge.mdx`, opening: "ObjectStack does not ship its own RAG engine. The market has many mature options (…) and competing with them on chunking, embeddings, hybrid retrieval, and rerankers is not where the framework can add value." | The platform owns assembly, sync and reconcile, structural split and record-level return. Engines are integrated for embedding, hybrid retrieval, rerank and file parsing. Chunking leaves the list of things the framework does not do. | row 2 |
| Same file, §1: "We have nothing distinctive to add to those layers." and "The protocol scopes the framework's responsibility to (1)–(4) and delegates the rest to plugins." | The framework's list grows by the four of K1; what is delegated is the adapter's four. | row 2 |
| Same file, §3.1: a source "is stored as metadata (versioned, environment-scoped) just like a view or a flow", against the schema note on `packages/spec/src/ai/knowledge-source.zod.ts#KnowledgeSourceSchema`: "the shape of a **runtime registration**, ⛔ not a governed metadata type". | The two agree: a source is a `knowledge_source` item (K4). Until row 3 lands, the schema note is the true one. | row 3 |
| Same file, §3.2: "The framework does **not** chunk; adapters do." | The framework splits; adapters index the passages. | row 6 |
| Same file, §3.4, and the note on `packages/spec/src/contracts/knowledge-adapter.ts#IKnowledgeAdapter`: "The surface is **deliberately minimal**: no chunk strategy, no embedding configuration, no rerank toggles." | The contract grows by K8's list. It still carries no embedding configuration and no rerank or hybrid toggle. | row 2, then each row that adds a member |
| Same file, §6: "that surface stays unbuilt until a real `object` source calls for it." | The enumeration surface is built (K8); reconcile covers application-level predicate writes. | row 2 and row 15 |
| Same file, §7 and §8: `knowledge-pgvector` as "Phase 3", and "a `KnowledgeSource.embedding` field". | `knowledge-pgvector` is an open adapter of this repository (cloud ADR-0119 D5); `embedding` is removed (K6). | row 8, row 3 |
| `packages/spec/src/ai/embedding.zod.ts`, file note: "NOT in scope (these belong to application code, not the platform): Chunking strategies (fixed/semantic/recursive/markdown)." and "These were removed in v1 because they describe one specific way to build a RAG application". | Structural splitting is a platform capability of the knowledge service. It does not return as the pipeline vocabulary that was removed. Retrieval pipelines, document loaders and end-to-end orchestration stay out of scope. | row 6 |
| `packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeService`, class note: "Non-responsibilities (the parts plugins own): Chunking, embedding, vector storage, hybrid retrieval, rerank." | Chunking moves to the responsibilities, with reconcile and record-level return. Embedding calls, vector storage, hybrid retrieval and rerank stay the adapter's. | rows 2, 6 and 10, each for its part |
| `packages/spec/src/ai/knowledge-document.zod.ts`, file note: "The framework does **not** prescribe chunk strategy or vector format. Adapters are free to chunk however they like", and the note on `#KnowledgeChunkSchema`: "Adapter-produced chunk of a document." | The framework prescribes the split and still not the vector format. A chunk is produced by the platform and handed to the adapter. | row 6 |

The same position is restated in `content/docs/ai/knowledge-rag.mdx` ("Why we did not build a vector DB"), in the READMEs of the three knowledge packages and in `skills/objectstack-ai/SKILL.md`. They follow the same rule; `skills/**` is a governed surface and takes its own PR.

**The rule for all of them (Prime Directive #10).** A text is rewritten in the PR whose code makes the new sentence true, and not before. This record changes no file outside `docs/adr/`. A reader who meets an old sentence in the meantime finds this record through the ADR index.

### K3 — What this record supersedes

**1. The three judgements of #4606, and its restart condition.** #4606 (2026-08-02, closed 2026-09-24) recorded the maintainer's positioning in its body:

- Judgement 1: 「企业应用平台里,agent 的第一知识源是业务数据和元数据,不是文档库。」 and 「平台的差异化在治理(谁能检索什么,source 级权限),不在检索引擎」. The first sentence stands: an object source is business data. The second is replaced by K1. Beside governance, the platform owns the four parts of retrieval that depend on the record model.
- Judgement 2: 「现有架构姿态即终态:契约在核心,引擎靠集成。」 and 「知识库是插件位,不自建。开源核心零新增承诺。」 Replaced. The posture is not final: the open core takes on the four mechanisms of K1 and the contract additions of K8. "Engines by integration" stands for the adapter's four.
- Judgement 3: 「商业归属:企业版。」 and 「向量库/embedding/文档管道的成本结构是托管云付费点,不进开源核心。」 This is a commercial line and is not this record's to draw. It is replaced by cloud ADR-0119: both vector stores are open (its D5), and its D6 lists where the Enterprise value sits.
- The restart condition, 「重启触发条件(满足任一再评估,评估≠立项)」, listed three triggers, and 「触发后的既定路线」 put the work in cloud on the `knowledge-ragflow` route. Neither is applied. The maintainer restarted the work by his own words on 2026-11-24, and the route is the epic's four phases. The "real object source" that the cards written under #4606 waited for is BrightRule ([Context](#the-consumer-that-exists)).
- What stays of #4606: 「enforced 先行」. A key enters the spec with the path that reads it. It is the epic's rule now ("A key lands with its first reader in the same PR") and K4 applies it.

**2. The adapter-list deferral in `packages/services/service-knowledge/src/knowledge-service-plugin.ts`.** Three comments in that file hold the contract shut on #4606's authority: application-level predicate writes stay uncovered "until a real object source justifies the adapter-enumeration surface it would need (#4606's enforced-first rule)"; the reap guard was added with "No spec key, no `IKnowledgeAdapter` member, no `packages/objectql` change (#4606's zero-addition boundary)"; and the guarded object set is read once because making it dynamic "is precisely the addition #4606 rules out until a real `object` source exists to justify it". All three conditions are met and the deferral ends. Enumeration is K8's first item, with row 2 as its reader; the guarded set becomes dynamic in row 3. Those rows rewrite the comments.

**3. The no-reconcile option of #4672.** The maintainer's ruling of 2026-08-05 on #4672, relayed by the services lane's PM (record [`5194621834`](https://github.com/objectstack-ai/objectstack/issues/4672#issuecomment-5194621834)), approved option C: 「仅做 reap guard 去索引化(知识插件注册 lifecycle reap guard,行删除前按 id 去索引),零新增契约面、不碰 `packages/objectql`、不建对账子系统;应用层谓词写部分诚实不覆盖,待真实 object 源出现再按 #4606 的 enforced-先行原则回看(Q2 = B 现在 + A 待触发,同案批准)」.

- Superseded: 「不建对账子系统」 and 「应用层谓词写部分诚实不覆盖」. Reconcile is the platform's (K1). The 「A 待触发」 half, an enumeration method on the adapter, is triggered.
- Not revived: the earlier approval of a reconciliation subsystem on that card (record [`5163029794`](https://github.com/objectstack-ai/objectstack/issues/4672#issuecomment-5163029794), 2026-08-03), which the 2026-08-05 ruling voided. This record decides that reconcile exists and who owns it; its trigger and its batching are row 15's.
- What stays: the reap guard as landed, and its failure direction. A row may outlive its index entry; an index entry never outlives its row.

**4. The 2026-11-15 words on #33933.** The card body of #33933 records them: 「知识库 根本还没开始开发」 and 「知识库甚至不应该加载这个插件，目前不是本项目的重点」. They are superseded by the maintainer's words of 2026-11-24, as record [`7134104071`](https://github.com/objectstack-ai/objectstack/issues/33933#issuecomment-7134104071) on #33933 states. That card's own change stays valid (PR #36975: the knowledge settings appear only where the service is mounted). The epic's row 9 will change the default shape on purpose and name that card and its pin when it does.

### K4 — `knowledge_source` is admitted as a metadata type

Ruling D2: `knowledge_source` becomes a governed metadata type referencing objects, and the object carries no recipe.

**ADR-0088's three clauses.**

1. **Independent lifecycle.** A source is created, changed, switched and removed under its own name. Its index is built, rebuilt as a new generation (K7) and dropped with it. It is not a facet of its object: two sources may index one object with different content, a different `where` and different readers, and today's docs already tell an author to put sensitive fields in a separate source. The object carries nothing: this record adds no object key, and the object-side AI declaration that exists, `enable.aiReadable`, is refused on business objects (`packages/spec/src/data/ai-read-exposure.ts`).
2. **Declarative governability.** A source ships as a document in a package, through a file loader, and is authored at runtime through Studio and through MCP (`allowRuntimeCreate`); the epic's phase 3 states both. It is versioned. This record opens no environment overlay for it: `allowEnvironmentOverlay` keeps the registry's default, `false`, until a ruling says otherwise (ADR-0005).
3. **A real consumer.** The knowledge service reads `knowledge_source` items and its behaviour changes with them: it registers each source, builds and syncs its index, serves it in search, and lists it in every `search_knowledge` answer. The type and that reader land in one PR (row 3: registry row, stack collection, loader with subscribe-and-reload), so the type is never a placeholder. An application waits for it: BrightRule's source is registered in code today.

**One schema.** The type's one Zod source is `packages/spec/src/ai/knowledge-source.zod.ts#KnowledgeSourceSchema` (Prime Directive #7, ADR-0005). No second schema is written beside it. The type name is `knowledge_source`, singular. The stack collection's name and the file suffix are row 3's; a name in this record is a proposal.

**"Referencing objects."** An item names one object and fields of that object. It defines no object, extends none, and is refused when the object or a named field does not exist (the lint and `os validate` checks are row 4).

**The v1 keys are the keys something enforces.** The right column names the enforcer read at `254e396a29`; "none" means no file under the service or either in-tree adapter reads the key.

| Key today | In v1 | Enforcer |
|:--|:--|:--|
| `id` | renamed `name` (K6) | the registry key, the document id (`packages/services/service-knowledge/src/knowledge-service.ts#documentIdFor`), the `sourceIds` of a search |
| `label`, `description` | kept | the `sources` list of a `search_knowledge` answer (`packages/services/service-knowledge/src/knowledge-tools.ts#SearchKnowledgeSourceSummary`) |
| `adapter` | kept as it is; see point 2 below | adapter routing (`packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeService`) |
| `adapterConfig` | kept as it is; see point 2 below | read by the adapter it names (`packages/plugins/knowledge-ragflow/src/index.ts#extractRagflowOptions`) |
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

- **An unknown key is refused, not dropped.** Today the schema is a plain object, and a parse drops what it does not declare. On a governed type that is a silent no-op (Prime Directive #12).
- **A key added later lands with its first reader**, in the same PR: the split settings with the splitter (row 6), and so on. No key is reserved here.

**▲ Point 1, past the rulings' words — the `file` and `http` shapes are retired.** The card asks this record for the fate of the two runtime-registration shapes that the `knowledge-ragflow` README and tests use, and names the rule ("one strict contract"). It does not name the fate. Three rules that are settled produce one:

- ruling D2 makes the type one that references objects;
- a v1 key needs an enforcer, and none of `prefix`, `mimeTypes`, `urls`, `userAgent` has one. For such a source `reindexSource` answers `ok: false`, and its hits pass with no permission check: the docs call that "the adapter's problem", and no in-tree adapter reads a document's `permissions`;
- one strict contract (Prime Directive #12) leaves no room for a second, code-only source shape beside the governed one.

So the two arms leave `KnowledgeSourceSchema` in the PR that admits the type, with an ADR-0087 disposition (K6). `knowledge-ragflow` keeps working: it reads only `adapterConfig.datasetId`, so its README and tests move to an object source. What is lost is a corpus ingested outside the platform (files loaded into an external engine by hand) that a deployment searches through a registered `http` or `file` source. That returns as a new arm with a full design (schema, loader, reader, and an answer for permissions), with the parsing adapter that is its first reader, as ADR-0088 asks of a returning kind. **The approver accepts this with the record or strikes it**; struck, the fate goes back to the maintainer and row 3 waits for it.

**▲ Point 2, past the rulings' words — `adapter` and `adapterConfig` are kept as they are, and the question is named.** Both have enforcers, and the card's list of renames and removals does not touch them, so this record keeps them. But a source that ships in a package names an adapter the deployment may not have, and the epic's row 9 says the adapter is "picked by database". Whether `adapter` stays required on an item, or becomes optional with the deployment's adapter as the default, is not settled by the card or the rulings. This record does not decide it. It must be ruled before row 3 freezes the type's v1 shape, because a hosted environment cannot load application code to supply an adapter.

**▲ Point 4, past the rulings' words — registration in code stays a door for the same schema.** The epic's phase 2 says sources are still registered in code, and row 3 adds the metadata door. This record reads "one strict contract" as one shape, not one door: `KnowledgeServicePlugin({ sources })` and `registerSource` remain, they take the type's schema and nothing else, and they parse with it (today `registerSource` stores what it is given without a parse). Whether the code door is closed once every source can be metadata is not decided here.

### K5 — A source lists its content fields; embedding is egress

Ruling D5: a source lists its content fields explicitly.

- **`content` is a non-empty list of field names of the source's object. `'*'` is refused**, at parse, with a prescription that says to list the fields.
- **Why.** Embedding is egress. The text of every listed field is sent to the embedder, which for most deployments is an external provider, and is stored in an index outside the row store. Today a `'*'` member means every non-empty string value of the record except `id` (`recordToDocument`). A text field added to the object later starts leaving the row store with no change to the source. With a list, what leaves can be read from the source, and a new field does not leave until an author adds it.
- **Everything else a document carries is declared too**: `metadataFields` is already a list, and the title is the object's display field (#36994).
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

If point 1 is accepted, the `file` and `http` arms and their four keys retire in the same PR as one more family. They have no mapping: nothing read them, so there is nothing to convert them to.

1. **All of it lands in row 3's PR, with the type**, as the epic's row states. That PR's changeset carries `Metadata-protocol: narrowed` (it adds a type and narrows keys, and `narrowed` wins over `added`), the `(narrowing)` arm on its `Clause-②:` line, a BREAKING banner, the FROM → TO table above, and one ADR-0087 marker that names registered entries. On a declared narrowing the `not-required (no-migration-prescription)` category is refused, so the family is a registered semantic entry (ADR-0087 D3: one entry per retirement family).
2. **No stored-row ceremony.** Nothing is stored.
3. **Every door runs the same kit.** A source reaches the service through the stack collection (from row 3) and through registration in code (point 4). Neither door keeps an alias of its own (Prime Directive #12): the code door either runs the same conversion entries or refuses with the tombstone's prescription, and row 3 states which, with a pin. The compiler is the third channel: a tombstone types its key `never`, so a TypeScript registration that still writes `id` or `contentFields` does not compile.
4. **A rename changes no value.** Document ids, which are built from the source's name and the record id, do not change, so no rename forces a rebuild; and a fingerprint is computed over values, never over key spellings, so no rename starts a generation (K7).
5. **Nothing else is renamed.** The `sourceIds` argument and the `sources[].id` member of `search_knowledge`, and `sourceId` on a document and on a hit, are tool and document shapes. They carry the source's name and keep their spelling.
6. **First-party instances move in the same PR or its paired teaching card (row 5b)**: `content/docs/protocol/knowledge.mdx`, `content/docs/ai/knowledge-rag.mdx`, the package READMEs, the service's tests, and `skills/objectstack-ai`, which teaches `contentFields` and the `*` member today. Outside this repository: BrightRule's registration and cloud's `knowledge-turso`.
7. **This record fixes the dispositions, not the file list.** Which kit files and generated baselines move is the retirement kit's own contract and its gates'.

### K7 — One index fingerprint; a changed fingerprint is a new generation

The index of a source has **one fingerprint**. The platform computes it, in one function, from five components:

| Component | What it is | Where it comes from |
|:--|:--|:--|
| Embedding model | the identity of the model whose vectors the index holds | the embedder the deployment configures |
| Dimensions | the width of those vectors | the same (`IEmbedder` already carries `dimensions`) |
| Split configuration | the source's split settings as parsed, defaults applied | the source |
| Split algorithm version | a constant the splitter exports; it changes when the splitter gives different passages for the same text and settings | the splitter |
| Content recipe | what assembly reads to build the text of a document | the source and the assembly function |

**A changed fingerprint means a new generation.** A generation is one complete index of one source under one fingerprint.

1. **Generations never mix.** Every stored passage belongs to one generation, and no search is answered from two. Vectors of two models, or passages of two splits, are never ranked against each other.
2. **A new generation is a full rebuild**, and the generation it replaces is dropped afterwards (K8, drop). Which generation a search reads while the new one builds is row 8's to state, with a test.
3. **The adapter stores the fingerprint beside the generation and reports it.** The service compares it before it writes. A mismatch is never silent: the service does not write passages of one fingerprint into an index built under another, and it says that the source needs a rebuild. This catches the deployment-wide case, where a change of embedding model in the settings changes the fingerprint of every source at once.
4. **The fingerprint is computed over values, in a fixed order, and pinned by a test.** The same source and the same embedder give the same fingerprint on every machine. A key rename changes no value and so no fingerprint (K6).
5. **The fingerprint is derived, never authored.** No key on a source sets it.
6. **Where the engine embeds inside itself**, the model and dimensions components are what the adapter reports for that engine. The platform does not guess them.

The first reader is row 8 (`knowledge-pgvector`: per-dimension tables and fingerprinted generations); `knowledge-turso` follows when it moves (row 7). The serialization is row 8's.

**▲ Point 3, past the rulings' words — what "content recipe" covers.** The card names the component and does not define it. This record reads it as: the object, the ordered `content` list, and the version of the assembly rule (how the listed values become one text). It leaves out `where` and `metadataFields`, for this reason: the fingerprint answers one question, whether a vector stored yesterday may be ranked against a vector computed today. A changed `where` changes which records have a document, and reconcile repairs that inside the same generation. A changed `metadataFields` changes what is stored beside a vector, and a rebuild inside the same generation repairs that. The approver accepts this reading with the record or strikes it.

### K8 — Adapter-contract additions, each with its first reader

The epic holds the contract shut until this record merges ("No new adapter-contract members before #37001 merges"). This is the list that may then be added. **This record adds no member**: the PR that lands it changes no file under `packages/`.

| # | Addition to `IKnowledgeAdapter` or its option types | What it is for | First reader |
|:--|:--|:--|:--|
| 1 | **Enumerate**: a paged listing of the documents an index holds for a source, with their record ids | to find documents whose record is gone or no longer matches | row 2 (the reindex purge); row 15 (the daily reconcile) reads it next |
| 2 | **Drop**: remove a source's whole index, or one generation of it | a removed source; a superseded generation | row 2; row 8 for a generation |
| 3 | **Capabilities**: the adapter states which of these additions it supports | so the service refuses a source by name when its adapter lacks what the source needs, and never degrades silently | row 2, with the contract test suite. #36990's rule names "capabilities" among the members that wait for this record; placing it with row 2 is this record's reading, because the purge is the first thing an adapter may lack |
| 4 | **Chunk channel**: the write path carries the platform's passages (`packages/spec/src/ai/knowledge-document.zod.ts#KnowledgeChunkSchema`) instead of whole documents for the adapter to split | structural split is the platform's (K1) | row 6 |
| 5 | **Fingerprint and generation**: the adapter is told the generation on write and on search, and stores and reports its fingerprint | K7 | row 8 |
| 6 | **Organization filter**: a typed organization constraint on write and on search | one store holds several organizations' documents with no cross-read | row 8 |
| 7 | **Typed scope filter**: a typed form for what is an opaque `filter` record today, built by the service from `scope: [{ object, ids }]` | searching inside one record's documents | row 11 |

Additions to neighbouring contracts, listed here so they are not mistaken for adapter members:

- `IEmbedder` gains a declared input limit, so the splitter can keep a passage under it and say what it did with one that is over (row 6).
- `IKnowledgeService`'s search options gain `granularity` and `groupBy` (row 10) and `scope` (row 11). Grouping by record is the service's work (K1). If record-level return needs anything of an adapter, row 10 names it and it joins this list by a dated note here.

Rules for every addition:

1. **A member lands with its first reader, in the same PR**, and with a case in the contract test suite that row 2 creates. Every in-tree adapter runs that suite: `knowledge-memory`, `knowledge-ragflow`, `knowledge-pgvector`, and `knowledge-turso` once it moves.
2. **Names and signatures belong to the reader's card.** The names in the table are proposals.
3. **Whether a member is required, or optional behind a capability, is row 2's decision**, made with the suite. Either way nothing is skipped silently.
4. **What never joins the contract**: embedding configuration, hybrid weights, rerank toggles and parser options. They stay in the adapter's own plugin options or in `adapterConfig`.
5. **A member that is not on this list needs a dated note on this record first.**

### K9 — One `search_knowledge` definition, and every knowledge tool goes through the tool registry and the MCP seams

**What landed** (PR #36823, merged as `8aecf6d770`, read in the tree at `254e396a29`). The tool has one definition, `packages/services/service-knowledge/src/knowledge-tools.ts#getKnowledgeToolDefinitions`, and one executor, bound by `packages/services/service-knowledge/src/knowledge-tools.ts#createKnowledgeTools`. The knowledge service hands both out through `knowledgeTools()`. Both MCP transports register that definition and call that executor as the principal they bind, where the grant admits `data:read` (`packages/mcp/src/mcp-http-tools.ts#registerKnowledgeTools`; the HTTP bridge in `packages/runtime/src/domains/mcp.ts`, the stdio bridge in `packages/mcp/src/stdio-data-bridge.ts`).

`aiExposed` is enforced in that executor. The module note reads: "The tool enforces it HERE, in its executor, for every call: the sources it searches are the registered sources whose `aiExposed` is not `false`, and a `sourceIds` entry naming any other id, an unexposed source included, is refused `NOT_FOUND` with the same sentence an unknown id gets". And: "`IKnowledgeService.search` itself keeps searching an explicitly named source whatever its `aiExposed`: that service also serves the platform's own callers, which are not agents".

**The rules.**

1. **One definition for every transport** (ADR-0149 D2). The in-app agent registers the same definition and delegates to the same executor (objectstack-ai/cloud#4933, the epic's row 13). The epic's finish line is that the MCP door and the in-app agent serve byte-identical definitions.
2. **A new argument enters that one definition.** `scope`, `granularity` and `groupBy` arrive in row 12, after their readers in the service (rows 10 and 11). No transport adds an argument of its own.
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
2. No new adapter-contract member before this record merges; after it, only K8's list.
3. Answers read content as the asking user. The index copy is for ranking and snippets only.
4. The count of hits removed by the permission filter is never returned to the caller.
5. Embedding is egress: a source lists its content fields explicitly (K5).
6. One `search_knowledge` definition for every transport, and `aiExposed` stays enforced at the tool layer (K9).

---

## Execution (after acceptance)

The children are the epic's. ⛔ The session that wrote this record files none of them; the epic's owner files each row when its phase starts. The table says which part of this record each row carries.

| Epic row | Work | Carries |
|:--|:--|:--|
| phase 1: #36991, #36992 (#36995 is closed) | event sync honours `where`; paged reindex; embedder batches | nothing of this record; they add no contract member |
| 2 | adapter enumerate and drop, the reindex purge, the contract test suite | K1 (reconcile, purge half); K8 items 1 to 3; K2's first texts |
| 6 | the service-layer splitter, the chunk channel, the embedder input limit | K1 (split); K8 item 4; K7's split components |
| 8 | `knowledge-pgvector` | K7; K8 items 5 and 6 |
| 9 | the open runtime registers the knowledge service when a source exists | point 2; the default shape of #33933 |
| 10 | record-level return (`granularity`, `groupBy`) | K1 (record-level return) |
| 3 | the `knowledge_source` type with its loader | K4, K5, K6; points 1 and 4 as merged or as struck; point 2 must be ruled before it |
| 4, 5, 5b | lint and `os validate` checks; the Studio form; the skill and the MCP authoring schema | K4's reference checks; K6 item 6 |
| 7 | `knowledge-turso` moves here and takes the shared splitter | cloud ADR-0119 D5; K1; K7 |
| 11, 12 | the scope filter; the tool's new arguments | K8 item 7; K9 rule 2 |
| 13, 14 | cloud: the in-app agent registers the shared definition; the hosted kernel registers the service | K9 rules 1 and 4 |
| 15 | sync through the queue; the daily reconcile | K1 (reconcile); K8 item 1 |

---

## Points the rulings do not settle

The card's seven items, the maintainer's words and cloud ADR-0119 do not settle these four. Each is written above as this record's reading, marked ▲, outside every ruled block. Merging the record accepts them; any of them can be struck first.

| # | Point | What this record writes | The other answers |
|:--|:--|:--|:--|
| 1 | The fate of the `file` and `http` shapes (K4) | retired with the type's admission, to return as a designed arm with a parsing adapter | keep one key-less arm for a corpus an external engine ingests; or keep the two shapes as code-only registrations, which is a second contract |
| 2 | Whether a source must name its adapter (K4) | nothing: `adapter` and `adapterConfig` stay as they are, and the question is named | `adapter` optional, the deployment's adapter as the default; or `adapter` leaves the source and the deployment alone chooses |
| 3 | What "content recipe" covers in the fingerprint (K7) | the object, the ordered `content` list, the assembly rule's version; not `where`, not `metadataFields` | include `metadataFields`; include `where` |
| 4 | Registration in code after the type lands (K4) | stays, as a second door for the one schema | closed once every source can be metadata |

---

## Consequences

- **An author declares what is searchable in one place**, as metadata that ships with the application, and the fields that leave the row store can be read from that declaration.
- **One source gives the same passages on every adapter.** Changing the adapter changes how candidates are found and ranked, not what is indexed.
- **The adapter contract grows**, and the in-tree adapters must follow it under one test suite. What `knowledge-ragflow` can offer for enumeration and generations depends on the external engine; the capabilities declaration (K8 item 3) is how it says so.
- **Row 3 is a breaking change for anyone who registers a source in code**: five keys, and two arms if point 1 stands. BrightRule's registration and cloud's `knowledge-turso` change with it. The compiler and the tombstones name each edit.
- **A change of embedding model, of dimensions or of split is a full rebuild of every affected source.** That is the price of never ranking vectors of two models against each other.
- **Index-time work moves into the service.** Splitting, paging and reconcile are the platform's cost now, which is why the queue (row 15) follows.
- **`EmbeddingModelSchema` and `VectorStoreSchema` lose their only composer** when `embedding` and `vectorStore` leave the source. Whether they stay is row 3's finding under ADR-0049 and is not decided here.
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

Each text this record quotes was read on `objectstack-ai/objectstack` `main` at `254e396a29`. The numbers are a dated reading for the card, not anchors; the decision text cites symbols and files.

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

Readings that are counts: no file under `packages/services/service-knowledge/src`, `packages/plugins/knowledge-memory/src` or `packages/plugins/knowledge-ragflow/src`, tests aside, reads `prefix`, `mimeTypes`, `urls`, `userAgent`, a source's `embedding` or `vectorStore`, `refresh.cron`, or a document's `permissions` (0 matches each; the controls `adapterConfig` and `contentFields` match 3 and 6 times in the same three directories). Nothing under `examples/` registers a knowledge source: 0 matches for `KnowledgeServicePlugin`, against 38 files that match the control `defineStack`; `examples/app-todo` lists the two knowledge packages as dependencies and imports neither.

Readings from the tracker: #4606 has no comment, and its judgements are in its body. The ruling on #4672 is comment `5194621834`; it was relayed by the services lane's PM and names the maintainer. The 2026-11-15 words are in the body of #33933 and are restated in comment `7134104071`.

## Refs

- Card: [#37001](https://github.com/objectstack-ai/objectstack/issues/37001). Epic: [#37000](https://github.com/objectstack-ai/objectstack/issues/37000), with records `7135335668` and `7136687401`.
- Cloud: cloud ADR-0119 (objectstack-ai/cloud#4960, merged through objectstack-ai/cloud#4968 as `0aa3c54`), as reported in comments `7136374724` on #37001 and `7136912027` on #34830. Cloud cards named by those comments: objectstack-ai/cloud#4933, objectstack-ai/cloud#4969, objectstack-ai/cloud#4970.
- Superseded positions: [#4606](https://github.com/objectstack-ai/objectstack/issues/4606); [#4672](https://github.com/objectstack-ai/objectstack/issues/4672) (ruling `5194621834`, the voided approval `5163029794`, landed as PR #5987); [#33933](https://github.com/objectstack-ai/objectstack/issues/33933) (record `7134104071`, landed as PR #36975).
- Landed work this record reads: PR [#36823](https://github.com/objectstack-ai/objectstack/pull/36823) for #36650 (`8aecf6d770`); PR [#36850](https://github.com/objectstack-ai/objectstack/pull/36850) for #36839 (`7abf25f2c4`). Open: PR [#37075](https://github.com/objectstack-ai/objectstack/pull/37075) for #36991.
- Phase 1 siblings: #36991, #36992, #36993, #36994, #36995. The sibling epic on record context, whose rule on object recipes K4 shares: #36996, with its record card #36997.
- Admission precedent: [ADR-0159](./0159-forms-are-their-own-metadata-type-public-forms-are-form-items-view-is-lists-only.md), landed by PR #36957.
