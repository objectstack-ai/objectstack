# ADR-0160: Record-scoped AI inquiry — a context pack is its own metadata type, read as the caller and served by one tool; conversation focus, the `ask_ai` action type, the skill `context` key, the citation shape

**Status**: Accepted — merged 2026-11-24 (PR [objectstack#37115](https://github.com/objectstack-ai/objectstack/pull/37115)); amended 2026-11-25 (see **Amended** below). Written 2026-11-24 for objectstack#36997 (epic objectstack#36996) on the maintainer's acceptance of the epic's decision list that day, verbatim as the epic records it: 「需要拍板的事项 都同意」. It stands on cloud ADR-0119 (Accepted 2026-11-24), which rules this mechanism open source ([Provenance](#provenance)). `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted** by an authorized approval or the maintainer's merge of the PR that carries it, and is in force from that merge. **This record declares; it implements nothing** — no schema, no code, no changeset, and no anchor under `scripts/adr-anchors/`; every mechanism below is cut as a card after the merge ([Implementation split](#implementation-split-after-acceptance)).

- **Date**: 2026-11-24
- **Amended**: 2026-11-25, by the maintainer's word, verbatim: 「同意你的建议」. The maintainer was answering two independent analyses of this record, written in the maintainer's session on 2026-11-25 for [objectstack#36996](https://github.com/objectstack-ai/objectstack/issues/36996). One weighed points 1, 2 and 10 of [Points that go past the card's words](#points-that-go-past-the-cards-words), which this record said needed the maintainer's explicit acceptance. The other reviewed the six cards cut from the [Implementation split](#implementation-split-after-acceptance). The amendment records the following:
  - **Point 1** is accepted with three conditions: the several-packs refusal names each candidate with its label; the in-app pre-read never runs a pack the runtime chose; and validation gives advisory reports. See [D4](#d4) and [D8](#d8).
  - **Point 2 is changed.** A related child that *this caller* is not served is left out and stated, not refused. A child the door serves to nobody still refuses the call. See [D3](#d3).
  - **Point 10** is accepted as written.
  - **Long text in a related list's cells** is allowed under one bound on the pack's carried text, and every cut is stated. See [D3](#d3), "The bound on carried text".
  - Nothing else changes.
- **Amended**: 2026-11-25, a second time, by the maintainer's word, verbatim: 「related 的筛选和排序 同意」, as the thread of epic [objectstack#36996](https://github.com/objectstack-ai/objectstack/issues/36996) records it (card [objectstack#37202](https://github.com/objectstack-ai/objectstack/issues/37202)). The review behind the first amendment had left filter and order on `related` to the maintainer, as a protocol addition that needs its own amendment; this is that amendment. Its readings of the tree were taken on `main` at `0a1b69c0`. It records the following:
  - **`related` gains `where`, `orderBy` and `limit`**, on the child's own fields only, and the three leave "Later work". See [D1](#d1), "Filter, order and limit on a related list".
  - **The filter grants nothing.** It runs inside the caller's one capped child query. A `where` or `orderBy` field the caller cannot read drops the section, with the statement that some material is not visible, and the field is never named. See [D3](#d3).
  - **The read set is unchanged.** See [D4](#d4), "The seams".
  - **Point 5** and one line of [Consequences](#consequences) are updated, and the [Implementation split](#implementation-split-after-acceptance) gains row 11. The keys are declared here and land with their reader there; until then the schema refuses them.
  - **One sentence does not come from that word.** [D3](#d3), "The body", now names the cap on an outline's entries as a further constant of the service and a further stated cut. It is carried from the seat's review of the PR for objectstack#37178 (PR objectstack#37222, nit N5), read on that PR's head `2831c87e`.
  - Nothing else changes.
- **Decided by**: the maintainer, 2026-11-24, verbatim and untranslated, as epic [objectstack#36996](https://github.com/objectstack-ai/objectstack/issues/36996) records them: 「先立专题 ① 记录范围 AI 问询 ；⑤ 应用技能进入应用内 AI ，M0 那几项知识服务缺陷 也立专题，目前开发的策略是按专题派」 and 「需要拍板的事项 都同意」. The six rulings the epic sets over every child are quoted in [Provenance](#provenance); ⛔ none of them is re-opened here.
- **Card**: [objectstack#36997](https://github.com/objectstack-ai/objectstack/issues/36997). It lists ten items; D1–D9 decide items 1–9 in the card's order and [Not decided here](#not-decided-here) carries item 10.
- **Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (its ai row: a behavioural contract takes no environment overlay), [ADR-0011](./0011-actions-as-ai-tools.md) (an action reaches AI only through its `ai` exposure block), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce or remove), [ADR-0088](./0088-metadata-kind-admission-and-retirement.md) (the kind admission test), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D10 (the agent ceiling over reads), [ADR-0106](./0106-metadata-plane-fls-object-schema-masking.md) (the caller's served schema), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (the error envelope and its catalogue), [ADR-0149](./0149-ai-answers-business-questions-through-the-dataset-semantic-layer.md) D2 and M1 (one definition, one executor, every transport; guidance sentences belong to the executor), [ADR-0159](./0159-forms-are-their-own-metadata-type-public-forms-are-form-items-view-is-lists-only.md) (the latest kind admission; the form of D1).
- **Inputs**: every reading of the tree below was taken for this record on `objectstack-ai/objectstack` `main` at `e1dee7ae`. Code is cited by symbol anchor (`path#Symbol`) or by file, never by line. A package, module or member name this record introduces is a proposal; the tree's precedent and the implementing PR decide it.

---

## Provenance

**The cloud record.** cloud ADR-0119, "The record context pack, field egress and both vector stores are open source; governance over AI reads stays Enterprise", Accepted 2026-11-24 — card [objectstack-ai/cloud#4960](https://github.com/objectstack-ai/cloud/issues/4960), PR [objectstack-ai/cloud#4968](https://github.com/objectstack-ai/cloud/pull/4968). This record builds on three of its decisions and re-decides none:

- its **D1**: the `ai_context` metadata type, its render service (which reads as the asking user) and the `get_record_context` tool are open source in this repository;
- its **D3**: audit of AI tool calls, pattern masking of what a tool returns, and AI-identity narrowing stay Enterprise and are to apply to these reads. This record names that those interceptors apply and describes nothing of them ([D4](#d4), "The seams");
- its **D4**: cloud ADR-0025 and cloud ADR-0082 are not reopened. The open AI door stays MCP-only. The `focus` field is open spec; the in-app assistant's use of it — keeping the focus on a conversation, pre-reading the pack on the first turn — is closed cloud code.

**Four kinds of text feed this record.**

1. **Ruled.** The epic's "Rulings that bound every child", verbatim:

   > - A context pack is its own governed metadata type that names a root object. Objects carry no AI recipe; the object-level `ai` key stays refused on business objects (`packages/spec/src/data/ai-read-exposure.ts`).
   > - Read as the asking user: field- and row-level rules hold. A field hidden from the caller reads "not visible to you"; a related row the caller cannot read is absent, with no dangling id.
   > - One tool definition, declared once in spec and served by every transport (the ADR-0149 D2 pattern). The pack reaches a model as a tool result, never as system-prompt text.
   > - A key lands with its first reader in the same PR (ADR-0049).
   > - Focus is per conversation, one record in phase 1, client-reported and advisory: never an access decision.
   > - Field egress is not a dependency of this epic.

   Ruling 2's sentence on a hidden field meets ADR-0106 D1, which removes such a field from an ordinary caller's schema. How this record holds both is point 10 of [Points that go past the card's words](#points-that-go-past-the-cards-words).

2. **The card.** The ten items of objectstack#36997. The decision sections carry them.
3. **Fixed by a sibling card.** The `focus` contract of [objectstack#36999](https://github.com/objectstack-ai/objectstack/issues/36999), already in development. [D6](#d6) writes it exactly as that card states it.
4. **This record's own settlement.** Where a section had to choose past the words of 1–3, the choice is listed in [Points that go past the card's words](#points-that-go-past-the-cards-words), for the approver to accept with the record or strike.

## TL;DR

1. **`ai_context` is admitted as a metadata kind** ([D1](#d1)). A context pack names a root object and says which fields, related lists and body text of one record are handed to a model. v1 has six keys — `name`, `label`, `object`, `fields`, `related`, `body` — and each is read by the render service in the PR that adds the type.
2. **The recipe is not on the object** ([D2](#d2)). The object-level AI keys stay as they are ruled. A pack grants nothing and locks nothing.
3. **The render contract** ([D3](#d3)): every read is the caller's read. Fields carry labels and option labels. A field hidden by field-level rules never shows its value. Where the caller's own schema shows the field, it is named and reads "not visible to you". Where the caller's schema hides the field — the default for an ordinary caller under ADR-0106 — the pack names nothing and states that some of its material is not visible to the caller. A related row the caller cannot read is absent. A long body becomes an outline. Record material reaches the model inside one envelope written by one shared wrapper, apart from the executor's own notes.
4. **`get_record_context` is one definition, one executor, every transport** ([D4](#d4)): a read-family tool under `data:read`, subject to the record tools' system-object and API-exposure refusals. The root object is judged before any pack is looked up, and no answer names what the caller's schema hides. Its read set is a function of its arguments and published metadata, so anything installed on the ordinary tool seams can judge the call.
5. **The render service lives in a new service package** ([D5](#d5)), by the precedent of the dataset and knowledge tools. The name is a proposal.
6. **`ToolExecutionContext.focus`** ([D6](#d6)) is written as objectstack#36999 fixes it.
7. **`ask_ai` is an action type** ([D7](#d7)) that focuses the assistant on the record. It has no server dispatch, is never an AI tool, and is absent where there is no in-app assistant.
8. **The skill key `context`** ([D8](#d8)) names a pack, and a skill that declares it binds `get_record_context`. Its reader in this repository is the MCP skill prompt, which gains a record argument.
9. **A citation** ([D9](#d9)) is `{ object, id, anchor?, quote }`. Shape only; no schema lands before its reader.
10. **Not decided**: field egress, and the rest of [Not decided here](#not-decided-here).

## Context

### What exists, as measured

- **The record tools.** `packages/mcp/src/mcp-http-tools.ts#registerObjectTools` registers the record tools on the MCP door; `#wireBridgeTools` gates each family on its OAuth scope, the read family on `data:read` (`packages/spec/src/ai/mcp.zod.ts#MCP_OAUTH_SCOPE_DATA_READ`). The names the door may register are the closed set `packages/spec/src/system/constants/platform-tool-names.ts#MCP_DOOR_TOOL_NAMES`.
- **Their two refusals.** A system object is refused unless it declares itself AI-readable: the guard inside `packages/mcp/src/mcp-http-tools.ts#registerObjectTools` reads `#isSystemObject` and the bridge's `aiReadExposed` member (`#McpDataBridge`). API exposure (`apiEnabled`, `apiMethods`) is asked before every data call: `packages/runtime/src/action-execution.ts#callData` asks `packages/runtime/src/api-exposure.ts#checkApiExposure` for the HTTP bridge (`packages/runtime/src/domains/mcp.ts#buildMcpBridge`), and `packages/mcp/src/stdio-data-bridge.ts#enforceApiExposure` does for stdio.
- **A read that reaches a second object.** The header of `packages/mcp/src/mcp-relation-reads.ts` states the rule (#35145): every object a read shape reaches is judged by the read guard exactly as the object the call names, and a refused target refuses the whole call before any record is read — "never a silently smaller answer". `packages/mcp/src/mcp-relation-reads.ts#judgeRelatedLists` applies it to `get_record`'s `related`, `#judgeQueryExpand` to `query_records`' `expand`. Both judge the names the caller typed against the object as the caller is served it, and refuse the whole call with `INVALID_FIELD` for a lookup or a link field that definition does not show. One call is capped at 3 expanded lookups, 3 related lists and 20 rows a list (`#QUERY_EXPAND_MAX_FIELDS`, `#GET_RECORD_MAX_RELATED_LISTS`, `#RELATED_LIST_MAX_ROWS`), and a related-list read expands nothing.
- **What a refusal names.** The record tools name only what the caller typed. The docblock of `packages/mcp/src/mcp-http-tools.ts#notRecordedMembersOf` reads "Decided from two things only: the names the caller sent, and the object as the caller's own schema shows it", so "an object or a field the caller's schema does not show is answered exactly as one that does not exist". ADR-0106's amendment of 2026-11-11 says the same of an object the caller may not read.
- **A field the caller cannot read.** `packages/mcp/src/mcp-http-tools.ts#withheldFieldNames` (#35137) names a field as withheld only when the caller's served schema shows it and `getReadableFields` (`packages/spec/src/contracts/security-service.ts#ISecurityService`) leaves it out; a field the served schema does not show is never named. `packages/mcp/src/mcp-http-tools.ts#WITHHELD_FIELDS_NOTE` is the sentence: "Say they are not visible to you; never say they are empty or blank."
- **Which callers that rule reaches.** Under ADR-0106 D1 a field the caller may not read is removed whole from that caller's served schema; D8 makes this the default, and D4 exempts only system and platform-admin callers. So #35137 names a field only for an exempt caller, or with schema masking switched off. `packages/runtime/src/domains/mcp-object-schema-mask.test.ts` pins both sides: an ordinary member whose schema hides the field "is never answered it", and an exempt author whose schema shows it has it withheld.
- **A narrowing that names nothing.** `packages/spec/src/ai/dataset-tools.zod.ts#DatasetToolCatalogEntrySchema` carries `membersWithheld: true` when a member was left out because this caller cannot read a field it reads, "so an answer can say a measure exists that this caller may not see". ADR-0149 D2 rests it on ADR-0090 D10: a narrowed read arrives with the narrowing stated. The record tools carry the same kind of statement beside a narrowed list through the bridge's `diagnoseDelegation` member (`packages/mcp/src/mcp-http-tools.ts#McpDataBridge`). The sentence is the security service's (`describeDelegationNarrowing` on `packages/spec/src/contracts/security-service.ts#ISecurityService`), and `packages/runtime/src/domains/mcp.ts#datasetToolMembers` hands the dataset executor the same probe.
- **Masking.** `maskingRule` is "single channel — API, UI, export and AI context all see the same masked value" (`packages/spec/src/data/field.zod.ts`), enforced by `packages/plugins/plugin-security/src/field-masker.ts#FieldMasker`.
- **A reference to a row the caller cannot read.** The engine's expansion leaves the bare id; where the field declares `referenceNameVisible` it serves `{ id, name, readRefused: true }` (`packages/objectql/src/engine-reference-name-visible.ts#serveReferenceNames`).
- **Object-level AI keys.** `packages/spec/src/data/ai-read-exposure.ts#aiReadExposureRefusal` accepts `enable.aiReadable` only on a system object outside the stored-metadata family and refuses it on a business object; the write-arm spellings (`ai`, `aiExposed`, `aiWritable`, `aiWrite`, `aiEditable`) are refused with guidance in `packages/spec/src/data/object.zod.ts#CAPABILITIES_AI_WRITE_ARM_GUIDANCE`.
- **ADR-0149 D2 as built.** Tool I/O is zod in spec, projected to JSON Schema (`packages/spec/src/ai/dataset-tools.zod.ts#getDatasetToolJsonSchemas`). The executor is in the service that owns the read (`packages/services/service-analytics/src/dataset-tools.ts#createDatasetTools`). `packages/mcp/src/mcp-http-tools.ts#McpDataBridge` carries optional members, `#registerDatasetTools` registers them, and the runtime resolves the service by structure (`packages/runtime/src/domains/mcp.ts#resolveMcpDatasetToolsService`). The knowledge tool follows the same executor placement but keeps its JSON Schema in the service (`packages/services/service-knowledge/src/knowledge-tools.ts#createKnowledgeTools`), not in spec.
- **The tool seam.** `packages/mcp/src/tool-call-interceptor.ts#routeToolCallsThrough` hands an installed interceptor the tool name, the validated arguments and the principal (`packages/mcp/src/types.ts#McpToolCallContext`).
- **How a kind is registered.** `packages/spec/src/kernel/metadata-plugin.zod.ts#MetadataTypeSchema` and `#DEFAULT_METADATA_TYPE_REGISTRY`; `packages/spec/src/kernel/metadata-type-schemas.ts#BUILTIN_METADATA_TYPE_SCHEMAS`; the lockstep enum in `packages/metadata-core/src/types.ts`; the collection key in `packages/spec/src/meta-spelling/manifest-collection-spelling.ts#PLURAL_TO_SINGULAR`; a liveness ledger under `packages/spec/liveness/`; a showcase row in `examples/app-showcase/src/coverage.ts#KIND_COVERAGE`.
- **Actions.** `packages/spec/src/ui/action.zod.ts#ActionType` is `script`, `url`, `modal`, `flow`, `api`, `form`. `#ActionAiSchema` carries `ai.exposed`. `packages/runtime/src/action-execution.ts#isHeadlessInvokableAction` admits only the server-dispatched shapes and `#headlessActionTypeError` answers for the rest. The console's `ui/packages/core/src/actions/ActionRunner.ts#ActionRunner` dispatches from a table typed by `ui/packages/types/src/ui-action.ts#RunnableActionType`.
- **Skills.** `packages/spec/src/ai/skill.zod.ts#SkillSchema` is strict. `packages/mcp/src/skill-prompts.ts#registerSkillPrompts` projects a skill's instructions as an MCP prompt with no arguments (`#skillPromptResult`), offered when every tool it binds is served (`#skillBindingServed`).
- **The assistant surface.** `ui/packages/app-shell/src/hooks/useAiSurface.ts#useAiSurfaceEnabled` reports the surface enabled only when the agent catalogue serves the caller at least one agent.
- **`ToolExecutionContext`** (`packages/spec/src/contracts/ai-service.ts#ToolExecutionContext`) carries `currentObjectName`, `currentViewName` and `surfaceContext`, whose docblock says its fields are "advisory … never an access decision". It has no `focus` member.
- **No shared wrapper.** A tool result is its value serialized as JSON text (`packages/mcp/src/mcp-http-tools.ts#textResult`). A search of `packages/` found no shared function that marks tool output as data rather than instructions.
- **Nothing is taken.** `ai_context`, `get_record_context` and `ask_ai` are declared nowhere in the tree.

### What is missing

A user on a record page asks about that record. Today a model must compose the answer's material itself from `describe_object`, `get_record` and `query_records`: the application author has no place to say which fields, related lists and body text make up "this record's material", and nothing ties a conversation to one record. An external agent over MCP is in the same position. The epic closes this with one mechanism that both the in-app assistant and the MCP door use.

## Decision

### D1 — `ai_context` is admitted as a metadata kind; its v1 keys {#d1}

ADR-0088's three clauses:

1. **Independent lifecycle.** A pack is created, published, changed and deleted under its own name. It carries `object` itself, so it binds without the object knowing; several packs may root on one object; removing a pack changes no object, no permission and no other pack. It is addressed by name from two places, the tool's `context` argument ([D4](#d4)) and a skill's `context` key ([D8](#d8)). This is what the retired `validation` kind lacked: ADR-0088's addendum found it had no binding key and no reader outside the object.
2. **Declarative governability.** It ships from a package as a standalone file and is authored at runtime through the metadata API and Studio (row 7).
3. **A real consumer.** The render service behind `get_record_context` reads it and lands in the same PR as the type (row 5). Row 8 and row 9 add readers.

> **Cross-reference (2026-11-25, objectstack#37180).** Which package's pack a name means, in [D4](#d4)'s pack selection and in [D8](#d8)'s `context` key, is ADR-0150's question: its [addendum of 2026-11-25](./0150-behavioural-metadata-addressed-by-package-objects-keep-the-literal-prefix.md#addendum-2026-11-25-ai_context-joins-bucket-3) puts `ai_context` in bucket 3 beside `skill` and carries the interim rule for two packs that share a name and a root. Its follow-up, objectstack#37216, lands before row 8 (objectstack#37141). No sentence of this record is changed.

**v1 keys.** The schema is strict: an unknown key is refused at parse. Every key is read by the render service in row 5 (ADR-0049). The schema also bounds a pack's size — how many lookups its `fields` lists and how many `related` entries it holds — so a pack over a bound is refused at parse and nothing is cut silently at call time. Row 5 fixes the numbers and says how they stand against the record tools' per-call caps.

| Key | Meaning | Reader (row 5) |
|:--|:--|:--|
| `name` | The pack's machine name. | Pack selection ([D4](#d4)). |
| `label` | Human name. | The pack's header in the tool answer, and the refusal that names candidate packs. |
| `object` | The root object. Required. | Pack selection; the root read. |
| `fields` | Ordered field names on the root object. | The field section of the pack. |
| `related` | Child lists: `{ object, field?, fields?, where?, orderBy?, limit? }[]`. `object` is a child object with a reference field that points at the root; `field` names that field and is required when several do; `fields` are the columns of each row; `where`, `orderBy` and `limit` choose, order and cut the rows (second amendment, 2026-11-25, below). One level, child lists only — the shape of `get_record`'s `related`. The link is resolved once, on the published definition, so no caller's pack follows a different link than the author declared. | The related section. For `where`, `orderBy` and `limit`, the child query's filter, order and cut (row 11). |
| `body` | `{ field }`: the one long-text field rendered as the record's body. | The body section and its outline ([D3](#d3)). |

```yaml
# Illustration only. The schema is row 5's.
name: policy_document
label: Policy document
object: policy
fields: [title, category, status, effective_date, owner]
related:
  - object: policy_revision
    field: policy
    fields: [version, published_at]
body:
  field: content
```

**Filter, order and limit on a related list (second amendment, 2026-11-25).** A `related` entry may carry three more keys. They choose which child rows the pack carries, and in what order; they never widen a read. `orderBy` and `limit` are keys that `get_record`'s `related` already takes (`packages/mcp/src/mcp-relation-reads.ts#RelatedListRequest`); `where` is the one key a pack adds to that shape.

- `where`: a filter on the child's **own fields only**, in the platform's object filter form (`packages/spec/src/data/filter.zod.ts#FilterConditionSchema`). v1 admits `$eq`, `$ne`, `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`, `$null` and `$exists` on a field, joined by `$and` / `$or`. It admits no relation traversal (neither a dotted key nor that form's nested condition on the record a lookup points at), no field-to-field comparand (`{ $field }`), no `$now` anchor and no formula. Anything else is refused at parse, that form's other operators included (`#FILTER_OPERATORS`, `#LOGICAL_OPERATORS`).
- `orderBy`: `{ field, order }[]`, the shape of `packages/spec/src/data/query.zod.ts#SortNodeSchema`, on the child's own fields only. The direction is spelled `order`; that schema refuses `direction` by name. Without `orderBy` the read names no order, and the rows come in the data engine's order.
- `limit`: a positive integer, the most rows this list carries. It is at most the service's row cap for one related list (`packages/services/service-record-context/src/record-context-tools.ts#RECORD_CONTEXT_RELATED_MAX_ROWS`: 20 on `main` at `0a1b69c0`, and this record still sets no number). Without `limit` the cap applies. Like the pack's other bounds (**v1 keys** above), a `limit` over the cap is refused at parse and is never lowered silently at call time; `get_record` refuses a `related` `limit` over its own cap the same way.

The link filter stays the service's: `where` is joined to it with `$and`, so no `where` can reach a child row of another root. An example, for an application whose current text lives on a child: `where: { is_current: { $eq: true } }`, `orderBy: [{ field: 'sort_no', order: 'asc' }]`.

**Declared here, read in row 11.** The three keys land with their render-service reader in one PR ([Implementation split](#implementation-split-after-acceptance), row 11; ADR-0049). Until that PR merges, the schema that row 5 landed (`packages/spec/src/ai/ai-context.zod.ts#AiContextRelatedSchema`) is strict on `object`, `field` and `fields`, and refuses each of the three keys at parse.

**Registration (proposal, row 5 lands it).** One entry on each surface listed in Context. The registry row takes the `skill` row's flags, for the `skill` row's reason: a file loader (`**/*.ai-context.ts`, `**/*.ai-context.yml`), `supportsOverlay: true`, `allowRuntimeCreate: true`, `allowEnvironmentOverlay: false` (ADR-0005's ai row), `domain: 'ai'`; collection key `aiContexts`; a liveness row per key; a `KIND_COVERAGE` row with an example pack.

**Author defects are reported on author surfaces.** A pack that names an object or field that does not exist, a `related` entry with no reference field to the root, a `where` or `orderBy` that names a field the child does not have, or a `body.field` that is not a long-text field is reported by metadata validation at save and by `os validate`. An operator outside `where`'s admitted set is refused at parse, before any of this. ADR-0149 D2 is the precedent: a dataset member no caller could be served is reported on an author surface, and the tool answer says nothing about it ([D3](#d3)).

**Advisory reports (amended 2026-11-25, point 1's third condition).** Two configurations are legal but leave a call to fail at run time. Validation reports each one as an advisory warning, never an error:

- an object with more than one pack, where a skill binds `get_record_context` but declares no `context` ([D8](#d8)). With `context` omitted, that skill's call is refused ([D4](#d4)).
- an `ask_ai` action ([D7](#d7)) on an object that has no pack. The focus it sets has no pack to read.

The skill key and the action type that these reports read land in rows 8 and 6. Each report lands with its reader.

**Later work, not keys:** a fallback from `body` to knowledge search; reads through a parent lookup or deeper than one level, a `where` that follows a relation among them; a pack `description`; an override of a packaged pack ([ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) D2's list is not joined).

### D2 — The recipe is not on the object {#d2}

The rulings in `packages/spec/src/data/ai-read-exposure.ts` and `packages/spec/src/data/object.zod.ts#CAPABILITIES_AI_WRITE_ARM_GUIDANCE` stand and are not reopened. The card's phrase "the object-level `ai` key" means that family: `enable.aiReadable`, accepted only on a system object and refused on a business object, and the write-arm spellings, refused everywhere.

The reason the read key is refused on a business object is the reason the recipe cannot live there. The file's header says the record tools already read a business object as the caller, under its permissions and its API exposure, so the key "would change nothing". A pack does not change that either: it is not an exposure switch.

- Adding a pack makes no record, field or object readable that the record tools would not already serve the same caller.
- Removing a pack hides nothing: `get_record` still serves the record.
- One object may serve several audiences with several packs, and a pack has its own author and release.

An object therefore gains no key from this record.

### D3 — The render contract {#d3}

The render service takes a pack, a record id and the caller, and returns the pack's material for that record. v1 has one caller, the `get_record_context` executor.

**Read as the caller.** Every read goes through the data engine with the caller's execution context — no system context, no direct driver read. The reads are of four kinds, each one a read the record tools already make:

- the root record, as `get_record` reads it;
- a lookup listed in `fields`, as `query_records`' `expand` reads it on the root;
- a `related` entry, as `get_record`'s `related` reads a list: one capped query on the child, filtered by the link field joined with the entry's `where`, ordered by its `orderBy` and cut at its `limit` (second amendment, 2026-11-25). With a `where` it is the read `query_records` makes of the child, and still one query. The filter and the order run inside that one query, as the caller: a pack's `where` is written by the author and grants nothing, so the caller's row rules still decide which rows arrive;
- a lookup listed in a `related` entry's `fields`, as `query_records`' `expand` reads it on the child.

**The pack is projected before its reads are planned.** In the record tools the caller types the names, and a name the caller's schema does not show is answered `INVALID_FIELD`: the refusal names it and tells the caller to fix the request. In a pack the author typed the names and the caller sent none. The same answer would name a field the caller's schema hides, and would tell a model its request was malformed when it sent no field. So a pack may answer differently from a caller-typed read, and the order is fixed:

1. **Objects first.** Every object the pack names is judged at object level before anything of it is projected: the root ([D4](#d4), "Order of judgement"), then each `related[].object`. The gates are the ones the record tools put before the same read: the system-object refusal, API exposure, and whether the caller is served the object at all. For the root, and for a `related` child the door serves to nobody (the system-object refusal, or API exposure), a refusal here applies to the whole call. A `related` child that *this caller* is not served is left out instead ("Object level" below; amended 2026-11-25). `packages/mcp/src/mcp-relation-reads.ts#judgeRelatedLists` holds the same order: a child passes the guard "FIRST (nothing about a refused object is read, its definition included)", and only then is its definition read.
2. **Then fields.** Projection is a field-level step, on objects the caller is served. The executor projects the pack onto their definitions as the caller is served them (ADR-0106): the root's for `fields` and `body`, each child's for a `related` entry's link field and its `fields`. An entry that schema does not show is taken out of the plan and never read. The field-level rule below says what the answer carries in its place.
3. **Then lookup targets.** A lookup that survived projection has its target judged by the gate the record tools put before an expansion. This is the order of `packages/mcp/src/mcp-relation-reads.ts#judgeQueryExpand`: the field first, on the served definition, then the target's guard. A lookup the caller's schema hides was dropped in step 2, so its target is never judged and no refusal follows from a field the caller cannot see.
4. **Then the reads**, planned from what remains. Every planned read is one the record tools would accept from this caller, and it answers as that read answers.

**Object level (amended 2026-11-25).** The objects are judged in steps 1 and 3, by the gates the record tools put before the same read. This record adds no gate and skips none. What a refusal does depends on whom it refuses.

- **A refusal that applies to everyone refuses the whole call.** The door serves a `related` child to nobody — the system-object refusal, or API exposure turned off — or a gate refuses a surviving lookup's target. The call is refused in the record tools' envelope, and no partial pack is returned. This is an author defect: it shows on the first test call, whoever makes it. This is the #35145 rule (`packages/mcp/src/mcp-relation-reads.ts`) applied to a pack.
- **A `related` child that this caller is not served is left out.** This is the object-level visibility of ADR-0106's 2026-11-11 amendment. Nothing of the child is read, its definition included. Its section is not named. The notes carry the one statement of the field-level rule below: some of the material this pack covers is not visible to the caller. The child is judged before projection, as before, so projection never reads it. The pack still answers with the sections the caller may read. The reason: object permissions are configured per deployment, while a pack is authored and shipped with an application. A deployment that narrows one role's object access should shorten that role's pack, not switch it off. A refusal would also tell the caller nothing a statement does not.

The root object's gates are unchanged ([D4](#d4), "Order of judgement"). A root the caller is not served answers as `get_record` answers. The refusal names the refused object only when the caller's served schema shows it, and every such refusal carries one code ([D4](#d4), "The naming bound"). Where the record tools do not refuse, the pack does not either: a lookup whose target the caller may not read is left unexpanded by the engine, and the row-level rule below renders it.

**Row level.**

- The root record the caller cannot read, or that does not exist, answers as `get_record` answers for it.
- A related row the caller cannot read is absent. The list is read as the caller, so the row never arrives; the pack carries no id, count or marker for it. The one statement kept is the narrowing statement the record tools already carry beside a narrowed list, where the probe establishes one. The executor takes that probe as a dependency on both doors, as the dataset executor does (`packages/runtime/src/domains/mcp.ts#datasetToolMembers`): the MCP bridge hands it its `diagnoseDelegation` read, and the product registry hands it the security service's probe. A door that has no probe states no narrowing.
- A lookup the caller's expansion left unexpanded reads "not visible to you" and carries no id. The engine leaves a dangling id unexpanded too, and telling the two apart takes a read the caller cannot make, so both render alike. Where the field declares `referenceNameVisible`, the pack carries the name the engine serves, marked as not readable, and still no id: an id the caller cannot open is dangling.

**Field level.** No hidden value is ever carried. What the answer says depends on what the caller's own schema shows. The rules hold for a root field and for a column of a related list alike.

- **The caller's served schema shows the field and `getReadableFields` leaves it out** — an exempt caller, or schema masking switched off. The entry keeps its `name` and `label`, carries no value and is marked withheld. The notes name it, with the executor's sentence that such fields are not visible to the caller and are not empty. This is the #35137 rule, unchanged.
- **The caller's served schema does not show the field** — the default for an ordinary caller. The pack names nothing: no entry, no name, no count. The notes carry one statement, the same whatever was removed: some of the material this pack covers is not visible to the caller, and the answer must not treat it as empty or absent. This is the `membersWithheld` precedent of ADR-0149 D2. The statement fires only for an entry the published definition has and the caller's served schema hides. A name the published definition lacks is an author defect ([D1](#d1)) and fires nothing.
- **The hidden field is one the pack uses structurally.** A hidden lookup in `fields` is a hidden field: it is dropped as above and never expanded. A `related` entry on a child the caller is served, whose link field that caller's schema hides, is a read the record tools refuse this caller, so the whole section is dropped, with the same statement. A `related` entry whose `where` or `orderBy` names a field this caller cannot read is dropped whole too, with the same statement, and the field is never named (second amendment, 2026-11-25). That holds whether the caller's schema hides the field or shows it and field-level security withholds it: rows chosen or ordered by a value disclose it, so the data engine refuses a caller's filter or sort on a field that caller cannot read (`packages/plugins/plugin-security/src/predicate-guard.ts#assertReadableQueryFields`), and the read is not one the record tools would accept from this caller. A `where` or `orderBy` field the published definition lacks is an author defect and fires nothing, as above: the section is left out, and a filter is never read with one of its conditions removed. A hidden `body` field drops the body section, with the same statement. These are field-level rules, so they omit and state. Only an object-level refusal applies to the whole call. A child the caller is not served at all is settled at object level, in step 1: it is left out with the same statement, and it never reaches this rule.
- A masked value is carried as served. The render adds no masking and removes none.

This is how ruling 2's sentence — "A field hidden from the caller reads 'not visible to you'" — holds beside ADR-0106 D1, which removes such a field whole because a kept name "still leaks existence". The model is always told that something is not visible. It is told which field only when the caller's own schema already shows that field.

**Labels.** A field entry carries `name`, `label` and the value as served, plus a display form where the stored value is not what a person reads: the option label for a select-family field, the display name for a lookup. Labels are the metadata service's at the caller's locale, as ADR-0149 D2 localizes a dataset.

**The body.** A body within the service's bound is carried whole. A longer body is carried as an outline: its headings in order, each with an `anchor`. One section is read by calling the tool again with that `anchor` ([D4](#d4)). A long body with no headings is carried up to the bound and marked truncated. An outline is bounded too: the most headings one outline lists is a further constant of the service, and a cut outline says so (second amendment, 2026-11-25, carried from the review of objectstack#37178). Every cut is stated in the notes — a truncated body, a cut outline, a related list cut at its `limit` or at its cap, or a cell cut under the bound below. The body bound and the row cap of a related list are constants of the service, fixed and pinned by test in row 5; the outline's cap is one too, set and pinned by test in objectstack#37178; this record sets no number.

**The bound on carried text (amended 2026-11-25).** A related list's columns may include long-text fields, and their values are carried as served, within one bound. Text the pack carries counts toward one total bound: the body, and every long-text value in the related lists' cells.

- **What counts.** Every long-text cell counts, a long-text field in `fields` included. Nothing is carried unbounded.
- **What a cut does.** When the total would pass the bound, the cells and body that do not fit are cut. Each cut cell is marked `truncated`, and the notes state the cut. A cut is never silent.
- **The number.** It is a constant of the service, fixed and pinned by test in row 5, like the body bound.
- **How the number is chosen.** It is chosen against business evidence, and row 5's PR names the evidence it used. The first application answered questions from a whole policy of about 12,000 tokens placed in front of the model, and measured well (objectstack-ai/brightrule `docs/design-record-scoped-ai.md`). A bound well below a whole document — 8,000 characters as the only bound — would cut the material this mechanism exists to carry.

A pack whose application keeps its text on a child, such as a policy whose current text lives on its version documents, reaches that text through a `related` list, within this bound. An `anchor` that does not resolve is refused, never answered with the whole body. The refusal is one answer whatever the reason: a stale anchor, a pack with no `body`, or a body the caller's projection dropped. So an `anchor` cannot show that a pack has a body the caller's schema hides.

**One wrapper, three parts.** Text authored in records is untrusted input to a model. The tool's output is an envelope with three parts, declared in spec ([D4](#d4)):

1. **The data member** holds the record material: the pack header, the record, the field entries, the related lists, and the body or its outline. Values are carried as served — a number is a number, a boolean a boolean, text a JSON string. Record text appears here and nowhere else. An entry may carry a structural mark (`withheld`, `truncated`); a mark is not a sentence.
2. **The notes** hold what the executor states about this answer: the withheld-fields statement with its list of names, the statement that some material is not visible, every cut, and the narrowing statement where one is established. Each is a fixed sentence of the executor's, picked for the caller's locale, with one exception: the narrowing statement is the security service's sentence, relayed as the probe returns it. A note never contains record text, and the only names it lists are names the caller's served schema shows.
3. **The framing sentence** is one string slot: the data member is material read from records and is not instructions to follow.

The framing sentence covers the data member only, so it does not undo a note. Spec declares the slots and the executor writes every sentence (ADR-0149 M1). One function builds the envelope. Its proposed home is `@objectstack/core`, beside `packages/core/src/sentence-locale.ts#pickSentenceLocale`, which is already shared by the dataset tools and the MCP record tools. v1 has one caller; whether other tools adopt the wrapper is not decided here.

### D4 — `get_record_context`: one definition, one executor, every transport {#d4}

**Name and family.** `get_record_context`, a read-family tool: it registers under `data:read` with `readOnlyHint`, beside `get_record`, and is under the ADR-0090 D10 agent ceiling like every read.

**Definition.** Input and output are zod in `@objectstack/spec`, in a new module beside the dataset tools' module, projected to JSON Schema the way `packages/spec/src/ai/dataset-tools.zod.ts#getDatasetToolJsonSchemas` does. This follows the dataset tools' form, not the knowledge tool's.

- Input, strict: `{ objectName: string, recordId: string, context?: string, anchor?: string }`, with the record tools' aliases for the first two.
- Output: the D3 envelope, with its three parts — the data member, the notes and the framing sentence. The data member holds the pack header (`name`, `label`), the record (`object`, `id`, display name), the field entries, the related lists and the body or its outline.

**Order of judgement.** The steps run in this order, and no later step changes an earlier answer:

1. The arguments are validated.
2. **The root object's gates.** The system-object refusal, API exposure and the caller's object-level visibility of `objectName` are judged before any pack is looked up. A caller they refuse gets `get_record`'s answer for that object and record. The answer is the same whether or not a pack exists, so the tool never shows that an object the caller is not served has packs.
3. **Pack selection.** No silent fallback:
   - `context` given: that pack, if it exists and its `object` is `objectName`. Otherwise the call is refused with one answer, the same for a name no pack has and for a pack rooted on another object.
   - `context` omitted: the one pack whose `object` is `objectName`. If none exists the call is refused and the record tools remain the way to read the record. If several exist, the call is refused and the answer lists each candidate by name with its `label` (amended 2026-11-25: point 1's first condition, `label`'s second reader in [D1](#d1)). A machine name alone does not tell a model which audience a pack serves. These are packs rooted on an object the caller has just been shown to be served.
4. **The pack's other objects, projection and the reads**, in the order [D3](#d3) fixes. Each `related` child is judged at object level: a child the door serves to nobody refuses the call, and a child this caller is not served is left out and stated. Then come the field-level projection, the surviving lookups' targets, and the reads.

**The naming bound.** No refusal and no answer of this tool names an object, a field or a pack beyond the names the caller sent and what the caller is served: an object or a field the caller's served schema shows, or a pack rooted on such an object. It is the record tools' bound (`notRecordedMembersOf`), applied to names the author typed. So an object-level refusal of a `related` child or of a lookup's target names the pack and the root. It names the refused object only when the caller's served schema shows that object; otherwise it says the pack covers an object the caller cannot read, and no more. Every such refusal carries one code — `PERMISSION_DENIED`, the code #35145 uses — so the code does not tell a hidden object from a refused one.

**Executor and transports.** One executor, in the package of [D5](#d5), in the `createDatasetTools` form (definitions plus `execute`).

- MCP: `packages/mcp/src/mcp-http-tools.ts#McpDataBridge` gains optional members for it, under the same graceful-degradation contract as the dataset members; `#wireBridgeTools` gains a step gated on `data:read` and on their presence; both bridges implement them by calling the executor with the principal they already bind. `packages/spec/src/system/constants/platform-tool-names.ts#MCP_DOOR_TOOL_NAMES` gains the name in row 5.
- Product AI: cloud's tool registry registers the same definition and delegates to the same executor (row 9); `packages/spec/src/system/constants/platform-tool-names.ts#PLATFORM_TOOLS_BY_PACKAGE` gains the name with that registration.

**Refusals.** The system-object refusal and the API-exposure refusal of the record tools apply: the root meets them first, each `related` child meets them before projection, and a surviving lookup's target meets the guard `query_records`' `expand` puts before it (D3). Refusals answer in the ADR-0112 envelope with codes the catalogue already holds, under the naming bound; the tool coins no code. Every transport gives the same caller the same answer, and row 5 pins that with a parity test, as ADR-0149 D7 asks of the dataset tools.

**The seams.** cloud ADR-0119 D3 says its interceptors are to apply to this tool. The open contract that makes this possible without new seam code:

1. **It is an ordinary tool call.** On MCP it passes through `packages/mcp/src/tool-call-interceptor.ts#routeToolCallsThrough` like every tool; in the product it is a registry tool call. Anything that reads a pack for a model does it as this tool call — the first-turn pre-read of row 9 included — and never by calling the render service directly.
2. **It is a read.** The executor writes nothing.
3. **Its read set is knowable from the call.** The read set is the root object, each `related[].object`, and the target object of each lookup the pack lists, in `fields` or in a `related` entry's `fields`. It is a function of the validated arguments and published metadata only, never of the caller or of record data. A `related` entry's `where`, `orderBy` and `limit` add no object to the set (second amendment, 2026-11-25): `where` and `orderBy` name only the child's own fields, and `where` admits no relation condition. So a filtered pack reads the same objects as an unfiltered one, and an interceptor that judges the set judges both alike. The D5 package exports the one function that returns it for a call's arguments, and the executor plans its reads from that same function. A caller's projected plan ([D3](#d3)) reads a subset of the set, never more; row 5 pins by test that the executor reads no object outside it. The set is the call's plan when it is computed, not a guarantee across a publish: a pack published between an interceptor's judgement and the executor's reads changes it. The data door still decides every read.

### D5 — The render service lives in a new service package {#d5}

**Proposal:** `@objectstack/service-record-context`, under `packages/services/`, holding the render service, the read-set function and the tool executor. The name is a proposal; row 5 settles it by the tree.

The precedent decides the placement, not the name:

- A tool's executor lives in the service package that owns the read — `service-analytics` for the dataset tools, `service-knowledge` for `search_knowledge` — and the runtime resolves it by structure (`packages/runtime/src/domains/mcp.ts#resolveMcpDatasetToolsService`, `#resolveMcpKnowledgeToolsService`). No existing service owns "one record's material".
- Not `@objectstack/mcp`: the product registry must reach the same executor without an MCP hop, and ADR-0149 D2 keeps the MCP tool layer free of service code.
- Not `@objectstack/runtime`: the stdio bridge (`packages/mcp/src/stdio-data-bridge.ts#createStdioDataBridge`) must reach the executor too, and `packages/mcp/package.json` declares no dependency on the runtime. It takes the dataset executor from the host by structure, and takes this one the same way.
- The package prefix is `service-`, as `packages/services/` uses throughout; `plugin-` is frozen (AGENTS.md).

A host without the service registers no `get_record_context` and nothing else changes.

### D6 — `ToolExecutionContext.focus` {#d6}

The contract is fixed by objectstack#36999 and is restated, not changed:

- `ToolExecutionContext.focus?: { object: string; id: string }[]`, beside `surfaceContext` in `packages/spec/src/contracts/ai-service.ts`.
- Docblock: client-reported and advisory, never an access decision; the server re-reads the record as the caller; at most one entry in phase 1.
- Console: every turn's request carries `context.focus` while a focus is pinned. The request body is the authority; anything stored on the conversation only restores the chip.
- The name is `focus`: `scope` already means the conversation cache key in `ui/packages/app-shell/src/hooks/useChatConversation.ts`.
- Capability gate: the pin UI is drawn and `focus` is sent only when the AI service advertises that it honours focus — one flag on the discovery the console already reads, named in that card's PR and mirrored by the cloud child. Without the flag nothing changes.
- Entry point: a pin control on the page chip. The drawer entry (objectstack#36998) and the `ask_ai` action ([D7](#d7)) call the same setter when they land.

What this record adds is only how `focus` meets the rest:

- It is a member of a runtime contract, not authored metadata. Its writer is the console; its reader is the in-app assistant (row 9, closed cloud code per cloud ADR-0119 D4). The capability gate is what keeps a client from sending a value no server reads.
- `get_record_context` takes no `focus`. The record is always named in the tool's arguments, and the render re-reads it as the caller, so a forged `focus` entry reads nothing its sender could not read. The open MCP door has no conversation and no `focus`.

### D7 — The `ask_ai` action type {#d7}

`ActionType` gains `'ask_ai'`: an action on one record that focuses the assistant on that record.

- **Executor.** The console executor calls the focus setter of D6 with the record the action runs on and expands the assistant. It sends no message and makes no server call of its own. It is the same path as the pin control and the drawer entry.
- **One PR.** The spec member and the console executor land together (row 6): the dispatch table of `ui/packages/core/src/actions/ActionRunner.ts#ActionRunner` is typed over every runnable type, so the member alone would leave the console without an executor.
- **No target.** `ask_ai` names nothing: it joins `script` outside `packages/spec/src/ui/action.zod.ts#TARGET_REQUIRED_TYPES`, and a `target` on it is refused at parse. The pack is selected by D4's rule, not by the action.
- **Never an AI tool.** `ai.exposed: true` on an `ask_ai` action is refused at parse. It has no server dispatch: `packages/runtime/src/action-execution.ts#isHeadlessInvokableAction` does not admit it, so `list_actions` and `run_action` do not serve it, and the `action_` tool family (`packages/spec/src/system/constants/platform-tool-names.ts#PLATFORM_TOOL_FAMILY_PREFIXES`) never materialises it.
- **Absent without an in-app assistant.** A client draws the action only under the condition it draws the pin control: the assistant surface is on (`ui/packages/app-shell/src/hooks/useAiSurface.ts#useAiSurfaceEnabled`) and the AI service advertises that it honours focus. Otherwise the action is absent — not disabled, and not replaced by a notice. The open edition has no in-app assistant, so it shows no AI button.

### D8 — The skill key `context` {#d8}

`SkillSchema` gains `context?: string`, the name of an `ai_context` item: the pack this skill works from.

A skill that declares `context` binds `get_record_context` in `tools`, by name or by a wildcard that matches it; one that does not is refused at parse. A runtime that filters tools per skill needs the binding for the first read and for an `anchor` re-read. It also lets `packages/mcp/src/skill-prompts.ts#skillBindingServed` withhold the skill on a connection that does not serve the tool.

Two readers:

- **MCP skill prompts, in this repository (row 8, same PR as the key).** A skill with `context` lists one optional prompt argument, the record id; the object is the pack's root. When the argument is given, the prompt's message carries three things: the skill's instructions; one fixed platform-written line telling the client's model to call `get_record_context` with the arguments that follow; and those arguments as one JSON object — `objectName`, `recordId`, `context`. The record id the client sent appears only there, as a JSON string value, which is to say as a tool argument. It is never joined into the line. The pack itself is not placed in the prompt: it reaches the model as the tool's result, through the seam of D4. Without the argument the prompt is what it is today.
- **The in-app runtime, in cloud (row 9).** When a skill with `context` is active and the conversation's focus is a record of the pack's root object, the runtime reads that pack. Closed code; named here, not described, except for one rule (amended 2026-11-25, point 1's second condition): **the runtime never runs a pack it chose itself.**
  - **No active skill names a pack for the focused object.** The pre-read calls `get_record_context` without `context`. [D4](#d4)'s selection then applies. A refusal (no pack, or several) reaches the model as that tool result. It is not retried with a pack the runtime picked.
  - **Two active skills name different packs on that object.** The runtime pre-reads neither. The model calls the tool with the `context` its skill names.

A `context` that names no pack is an authoring error, reported where skills are validated. At run time the tool call it leads to is refused; no other pack is substituted. `packages/spec/liveness/skill.json` gains the key's row with its reader in row 8.

### D9 — The citation shape {#d9}

An answer may carry citations. One citation is `{ object: string, id: string, anchor?: string, quote: string }`:

- `object`, `id`: the record the statement rests on.
- `anchor`: a place in that record's body — an anchor the body outline issued (D3). Omitted when the citation is to the record as a whole or to a field.
- `quote`: the passage relied on, verbatim from text the tool returned.

It is the record sibling of what dataset answers carry — `sourceLine` on `packages/spec/src/ai/dataset-tools.zod.ts#QueryDatasetOutputSchema` and `#DatasetProvenanceSchema` — with one difference that shapes it. Those are composed by the tool and never typed by the model. A citation is written by the model, so it is a claim. The shape lets a reader check the claim without a model: `quote` must be found verbatim in what `get_record_context` returns for `object`, `id` and `anchor` to the reading user.

Shape only. No schema lands with this record or with row 5: the shape enters spec with its first reader (row 10, ADR-0049). Which member of an answer carries the list, whether a surface verifies before it renders, and how a citation opens the record are row 10's.

## Not decided here

- **Field egress** (card item 10): a field's declaration that it is never sent to AI, and its enforcement. cloud ADR-0119 D2 sets its tier and nothing else; the topic is not yet filed. It is not a dependency of this record: D3 carries what the caller may read, and a later egress rule narrows that on AI read paths.
- Vector retrieval and the knowledge platform (objectstack#37000, objectstack#37001), and with them the fallback from a long body to knowledge search.
- More than one focused record; a pack over more than one root record.
- How the in-app assistant keeps the focus on a conversation and pre-reads the pack (cloud, row 9), beyond that the pre-read is a `get_record_context` tool call.
- Citation rendering and verification (row 10).
- Audit, pattern masking and AI-identity narrowing (cloud ADR-0119 D3; cloud#4969, cloud#4970).
- Adoption of the data wrapper by any tool other than `get_record_context`.

## Points that go past the card's words

Each is this record's settlement, taken from the tree's precedent. Points 1, 2 and 10 change what a user sees and needed the maintainer's explicit acceptance. That acceptance was given on 2026-11-25 (「同意你的建议」): point 1 with three conditions, point 2 as amended, point 10 as written. The rest were the approver's, and were accepted with the merge.

1. **Pack selection** (D4): with `context` omitted, exactly one pack on the object is used; none or several is a refusal. There is no default pack and no synthesized one. *Accepted 2026-11-25 with three conditions:* the several-packs refusal names each candidate with its label (D4); the in-app pre-read never runs a pack the runtime chose (D8); and validation gives two advisory reports (D1).
2. **Object level** (D3). *Amended 2026-11-25.* A related child the door serves to nobody refuses the call, following #35145. Some user may be able to read the root but not one related object the pack names. That user gets the pack without that section, and with the statement of point 10. The merged text refused the whole pack instead, and left the author to write one pack per audience. That was changed because a pack ships with an application, while object permissions are set per deployment.
3. **A lookup the caller cannot open carries no id** (D3) — neither the bare id nor the id the engine serves beside a `referenceNameVisible` name. This extends the ruling's "no dangling id" from related rows to references. A dangling id renders the same way.
4. **A section is read with `anchor` on the same tool** (D3, D4), not by a second tool.
5. **`related` is child lists, one level; `body` is an object with one key** (D1), so a later key can join each without a reshaping. *Second amendment, 2026-11-25:* `where`, `orderBy` and `limit` join `related` that way, and no key is reshaped. The schema also bounds a pack's entry counts, so an oversized pack is refused at parse; a `limit` over the row cap is refused the same way.
6. **`ask_ai` takes no `target` and refuses `ai.exposed: true` at parse** (D7).
7. **The MCP prompt's record argument is optional, and the prompt names the tool call instead of carrying the pack** (D8). The call's arguments ride as a JSON object, and a skill with `context` must bind `get_record_context` in `tools`.
8. **The read-set function is exported** from the D5 package, and the pre-read is a tool call (D4). The set is the call's plan, not a guarantee across a publish.
9. **Registry flags, file suffix and collection key** follow the `skill` row (D1).
10. **A field the caller's schema hides is stated, not named** (D3). Ruling 2 says a hidden field reads "not visible to you". ADR-0106 D1 removes such a field whole from an ordinary caller's schema, so the #35137 naming reaches only exempt callers and deployments with masking off. The pack therefore names nothing for an ordinary caller and carries one statement that some of its material is not visible, on the `membersWithheld` precedent. Two alternatives are not taken: naming the field for every caller, which goes against ADR-0106 D1; and saying nothing, which falls short of ruling 2.
11. **A hidden field the pack uses structurally drops its part and does not refuse the pack** (D3). A hidden lookup is not expanded, and a `related` entry whose child the caller is served but whose link field is hidden is left out, each with the statement of point 10. A child the caller may not read at all is point 2's case: it is judged before projection and left out with the same statement. The alternative not taken is the record tools' answer to a caller-typed name, a whole-call `INVALID_FIELD`, which would name the field and blame a request that sent none.
12. **Order and naming** (D3, D4). The root object's gates are judged before pack selection, and each `related` child's before projection. A `context` that names no pack and one rooted on another object get one answer. An object-level refusal names the refused object only when the caller's served schema shows it, and every such refusal carries one code. A child left out for this caller is never named (amended 2026-11-25).

## Implementation split (after acceptance)

Rows 5–10 of the epic's table, with the epic's numbers, and row 11, which the second amendment of 2026-11-25 adds. Listed, not filed: the owning seat files them when this record merges. Each PR makes its own `Metadata-protocol:` declaration; the column is the expected one.

| Row | Card | Lane | `Metadata-protocol:` | Blocked by | Implements |
|:--|:--|:--|:--|:--|:--|
| 5 | Context pack: the `ai_context` type, the render service, `get_record_context` over MCP, the one data wrapper — the type and its reader in one PR | spec + server | `added` | this record | D1, D3, D4, D5 |
| 6 | Action type `ask_ai`: spec member and console executor in one PR | spec + ui | `added` | this record, objectstack#36999 | D7 |
| 7 | Studio form and authoring surfaces for `ai_context` (area:build) | ui | `none` | 5 | D1 |
| 8 | Skill key `context`; MCP skill prompts take a record argument | server | `added` | 5 | D8 |
| 9 | cloud: the in-app chat persists the focus and pre-reads the pack as a tool call on the first turn | objectstack-ai/cloud | — | objectstack#36999, 5, 8 | D4 (registry registration), D6 and D8 (cloud readers) |
| 10 | Answer citations that open the record at the cited place (split after this record merges) | — | `added` when the shape enters spec | this record | D9 |
| 11 | `related` filter, order and limit: the `where`, `orderBy` and `limit` keys and their render-service reader in one PR (second amendment, 2026-11-25) | spec + server | `added` | 5, the second amendment | D1, D3, D4 |

Row 11 is the one row this record itself adds, by the second amendment of 2026-11-25 (card objectstack#37203). Row 5 has merged (PR objectstack#37173) with `related` strict on `object`, `field` and `fields`, so row 11 is a PR of its own that adds the three keys and their reader together. It also settles where the row cap's number is declared, so that the schema that bounds `limit` and the service that cuts the list read one number; today the number is the service's alone.

The lanes of rows 5–10 are the epic's, and three of them understate the work. For that this record adds no row; the seat decides how the cards carry it.

- Row 7's form is a spec file, by the precedent of `packages/spec/src/ai/skill.form.ts`.
- Row 8's key is a spec key, with its liveness row.
- Row 9 has a half in this repository. The maintenance contract in `packages/spec/src/system/constants/platform-tool-names.ts` asks for the tool's name in `#PLATFORM_TOOLS_BY_PACKAGE` and for a `chatbot.tool.get_record_context` label in every pack under `ui/packages/i18n/src/locales/`. The name joins with cloud's registration and not earlier: a group there is the exact set a cloud package registers. So between row 8 and row 9 the `skill.tools[]` lint rule (`packages/lint/src/validate-ai-tool-references.ts`) reports `get_record_context` for a skill kept out of MCP (`mcpPrompt: false`) that declares `context`. The report is a warning, it is expected, and it is true: until row 9 no in-product runtime serves the tool.

## Consequences

- **One mechanism, two doors.** The in-app assistant and an external agent over MCP receive the same pack from the same executor, under the same caller's rules. The open edition gets the type, the tool and the skill prompt argument; it gets no AI button.
- **Nothing existing changes behaviour.** `get_record`, `query_records` and the dataset and knowledge tools are untouched. No object schema gains a key.
- **One pack can serve roles with different object access** (amended 2026-11-25). A related object a role cannot read is left out for that role, and the answer says that some material is not visible. Only an object the door serves to nobody refuses the pack, and that is an author defect. A field-level rule never refuses a pack either: it shortens the pack and says so.
- **An ordinary caller is told that something is hidden, never what.** The per-field "not visible to you" is seen only by a caller whose own schema shows the field (point 10).
- **The seams need no new code for this tool.** `get_record_context` is a read whose objects are known from its arguments; cloud#4969 and cloud#4970 can cite D4.
- **Three protocol additions follow** — a kind, an `ActionType` member, a skill key — each in the PR that brings its reader. The second amendment of 2026-11-25 adds a fourth: the three `related` keys of row 11.
- **A new package** joins `packages/services/`, if D5's proposal stands.

## Alternatives considered

- **The recipe on the object.** Refused by the epic's ruling and by D2: it would reopen the object-level AI keys and tie one object to one audience.
- **The pack in the system prompt.** Refused by the epic's ruling. It would also pass no tool seam, so nothing installed there would see the read.
- **A default pack when none is declared.** Not taken: the material is what the application author declares, and the record tools remain for everything else.
- **A second tool for body sections.** Not taken: one more name on every door for a read that differs by one argument.
- **The executor inside `@objectstack/mcp` or `@objectstack/runtime`.** Not taken, for the reasons in D5.

## Related

- Epic [objectstack#36996](https://github.com/objectstack-ai/objectstack/issues/36996); this card [objectstack#36997](https://github.com/objectstack-ai/objectstack/issues/36997); siblings [objectstack#36998](https://github.com/objectstack-ai/objectstack/issues/36998) (the record drawer's entry to the assistant) and [objectstack#36999](https://github.com/objectstack-ai/objectstack/issues/36999) (conversation focus).
- cloud ADR-0119 — card [objectstack-ai/cloud#4960](https://github.com/objectstack-ai/cloud/issues/4960), PR [objectstack-ai/cloud#4968](https://github.com/objectstack-ai/cloud/pull/4968); its consequence cards [objectstack-ai/cloud#4969](https://github.com/objectstack-ai/cloud/issues/4969) and [objectstack-ai/cloud#4970](https://github.com/objectstack-ai/cloud/issues/4970).
- Knowledge platform: [objectstack#37000](https://github.com/objectstack-ai/objectstack/issues/37000) and its boundary ADR [objectstack#37001](https://github.com/objectstack-ai/objectstack/issues/37001).
- Precedents in the tree: #35145 (a read that reaches a second object), #35137 (withheld fields), #34659 (the dataset answer's `sourceLine`, which covers dataset answers and not record citations).
