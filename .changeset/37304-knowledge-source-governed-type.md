---
'@objectstack/spec': minor
'@objectstack/service-knowledge': minor
'@objectstack/knowledge-memory': minor
'@objectstack/knowledge-pgvector': minor
'@objectstack/knowledge-turso': minor
'@objectstack/metadata-core': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
'@objectstack/objectql': minor
'@objectstack/core': patch
'@objectstack/metadata': patch
'@objectstack/cli': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
'@object-ui/fields': patch
---

feat(spec)!: a knowledge source is a governed metadata type, `knowledge_source`, loaded by the knowledge service

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #37310. Here only the enumeration row: `skills/objectstack-platform/SKILL.md` lists the new top-level key `knowledgeSources`, and `skills/objectstack-ai/SKILL.md`'s compiled `supportKb` example writes `name` and `content`, because the 18 spelling no longer parses.

<!-- adr-0087: registered knowledge-source-id-to-name, knowledge-source-content-fields-to-content, knowledge-source-inert-keys-removed, knowledge-source-content-lists-fields, knowledge-source-file-http-kinds-retired, knowledge-source-inert-keys-retired, knowledge-source-registration-governed -->

ADR-0161 K4, K5, K6 and K8 item 4 (#37304).

**BREAKING.** A knowledge source written for 18 is refused at parse until it is moved. `os migrate meta --from 18` lists every edit and `--write` applies the ones it can prove.

| Wrote (18) | Write instead (19) |
|:--|:--|
| `id: 'support_kb'` | `name: 'support_kb'` (the value is unchanged, so the index is found again and nothing is rebuilt) |
| `source.contentFields: ['title', 'body']` | `source.content: ['title', 'body']` |
| `contentFields: ['*']` | `content` with every field named (a hand edit: only the author knows which fields may leave the row store) |
| `embedding`, `vectorStore`, `adapterConfig`, `refresh.cron` | delete the key: nothing read it |
| `source.kind: 'file'` or `'http'`, with `prefix`, `mimeTypes`, `urls`, `userAgent` | a source indexes the records of one object (`kind: 'object'`); a file or URL source has no replacement |
| `knowledge.indexDocument(…)`, `knowledge.deleteDocument(…)` | no call: the service builds every document from the records a source selects; `reindexSource` rebuilds a source |
| `KnowledgeServicePlugin({ sources: [{ id, … }] })`, `registerSource({ id, … })` | the same call with the 19 shape, or the source shipped as metadata in the stack's `knowledgeSources` |

What changes:

- **The type.** `knowledge_source` is registered in the metadata type registry with the one schema `KnowledgeSourceSchema`; a stack carries its sources in the new top-level collection `knowledgeSources`, in `*.knowledge-source.ts` or `.yml` files. An item can be created and changed at run time (Studio, MCP); it takes no environment overlay. Studio's menu lists the type, and the metadata form bundles carry its label in every locale. Two packages may each ship a source of one name (ADR-0150, addendum of 2026-11-25): each has its own index, and `search_knowledge` lists a package's source as `NAMESPACE-NAME` and takes that spelling in `sourceIds`.
- **The schema is strict.** An undeclared key is refused, never dropped. `content` is a non-empty list of field names; an empty-string member is refused, and `'*'` is refused with the instruction to list the fields: embedding is egress, and the wildcard sent every text field of a record to the embedder, including one added to the object later. Credential-class and `internal` fields stay unindexed even when named.
- **The loader.** `KnowledgeServicePlugin` reads the published items when it starts and follows the type while it runs: an added source is registered and built when a build is due; a changed one is registered again, and a changed `where` or `metadataFields` rebuilds inside the generation while a changed `content` or `split` builds a new one; a removed one is unregistered and its index dropped. The reap guard now follows the sources, so a retention delete on an object first indexed by a source added after boot de-indexes the row. A deployment that holds an item and mounts no knowledge service says so once at boot, naming the items.
- **`IKnowledgeAdapter.dropSource?(ctx)`** removes everything an adapter holds for a source: every generation, the one under construction included, and what it recorded about the index. `knowledge-memory`, `knowledge-pgvector` and `knowledge-turso` implement it, and the contract suite (`@objectstack/service-knowledge/testing`) takes a new `implements.dropSource` declaration. Over an adapter without it, a removed source's index is kept and the service says so once. An adapter is handed the source's index key as `ctx.source.name` (it was `ctx.source.id`): the bare name for a source no package holds, so an existing index is found under the same key.
- **A capability of its own.** New platform capability `manage_knowledge_sources`: a write of a `knowledge_source` through `/meta` (REST and the dispatcher: save, publish, rollback, delete) and through the MCP draft door needs it beside `manage_metadata`. Platform administrators hold it by default; a grant on the indexed object's records does not imply it. A caller without it is refused `403 PERMISSION_DENIED`, naming the capability. The package doors ask it too: every write to an existing package that holds a knowledge source (an item, a pending draft, or for the commit revert and the rollback a commit that touched one) needs the capability: enable, disable, publish, publish-drafts, discard-drafts, the commit revert, rollback, revert, adopt-orphans, duplicate, ensure-customization, the manifest update and delete. A package that holds none is written as before, and the install door is not asked. A duplicate also admits each knowledge source it copies for the caller (source admission, below), and refuses the whole copy when one is refused.
- **Source admission at save.** Those same doors save a source only when its author may themselves search what it would index: an object of a disabled package, an object the API does not serve for `search`, a system object without `enable.aiReadable`, or a field the author may not query refuses the save `403`, naming the object or the field; a verdict that cannot be reached, or a knowledge service that is registered and cannot be resolved, refuses `503`. The fields judged are the ones the source serves and the ones its `where` reads, at save and at search: a source whose `where` reads a field a caller may not query is not searched for that caller. Over MCP it is the human who is judged. Where no knowledge service is mounted there is nothing to ask, and the save goes on.
- **One name, one source.** `KnowledgeServicePlugin({ sources })` and `registerSource` stay a door for the same schema and parse with it: a retired key is refused with its prescription (`400 VALIDATION_ERROR`), not converted. A source registered in code belongs to no package. It shares one slot with an environment-authored item of the same name, and the second of the two to arrive is refused `409 RESOURCE_CONFLICT`, naming both doors; a metadata item reloading its own earlier version is not a second arrival.
- **The push door leaves.** `IKnowledgeService.indexDocument` and `deleteDocument` are removed, with the `file` / `http` branches that served them. They are runtime-interface-only members with no metadata form, so the compiler reports each call (`TS2339`).
- **Removed exports**, twelve, all from `@objectstack/spec/ai`. The whole `embedding` module leaves with `embedding` and `vectorStore`, because the knowledge source was its only composer: `EmbeddingModelSchema`, `VectorStoreSchema`, `VectorStoreProviderSchema` and the types `EmbeddingModel`, `VectorStore`, `VectorStoreProvider`. The source kinds leave with `file` and `http`: `FileKnowledgeSourceSchema`, `HttpKnowledgeSourceSchema`, `KnowledgeSourceKindSchema` and the types `FileKnowledgeSource`, `HttpKnowledgeSource`, `KnowledgeSourceKind`. None has a replacement; an import of one is a compile error.
- **CLI.** `os knowledge status` prints the package that holds a source and no longer prints a source kind.
