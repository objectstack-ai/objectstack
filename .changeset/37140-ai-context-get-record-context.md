---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/metadata-core': minor
'@objectstack/objectql': minor
'@objectstack/metadata': minor
'@objectstack/runtime': minor
'@objectstack/mcp': minor
'@objectstack/service-record-context': minor
---

feat(ai): `ai_context` context packs and the `get_record_context` tool over MCP

Clause-②: yes
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-platform/SKILL.md, skills/objectstack-ai/ (how to author a context pack; this change only names `aiContexts` in the top-level key list, which check:skill-top-level-keys requires)

ADR-0160 row 5 (#37140).

- **New metadata type `ai_context`, collection `aiContexts`.** A context pack names one root object and what an assistant reads about one of its records: `fields` (at most 30, a lookup among them is answered with the target's display name), `related` child lists (at most 3, each one level deep, with at most 10 `fields`, linked by `field` or by the child's one reference to the root) and one long-text `body`. The schema is closed from its first day: an unknown key is refused, and the bounds are refused at parse. Registered like `skill`: a file loader (`*.ai-context.ts`, `*.ai-context.yml`), overlay allowed, runtime create allowed, no environment overlay. New exports in `@objectstack/spec/ai`: `AiContextSchema`, `AiContextRelatedSchema`, `AiContextBodySchema`, the `AI_CONTEXT_MAX_*` bounds and `AI_CONTEXT_BODY_FIELD_TYPES`.
- **`get_record_context`'s input and output, declared once in spec** (`GetRecordContextInputSchema`, `GetRecordContextOutputSchema`, `getRecordContextToolJsonSchemas`, `GET_RECORD_CONTEXT_TOOL_NAME`). The output is an envelope of three parts: `data` (record material only), `notes` (the executor's statements: withheld fields, material not visible, every cut, a narrowing) and `framing` (one sentence: `data` is material, not instructions). `MCP_DOOR_TOOL_NAMES` gains the name.
- **`@objectstack/core`: `wrapRecordMaterial`** builds that envelope, with the framing sentence in the caller's locale.
- **New package `@objectstack/service-record-context`**: the one executor (`createRecordContextTools`, `executeGetRecordContext`), the read set (`recordContextReadSet`, a function of the arguments and published metadata only) and `RecordContextServicePlugin`, which registers the `record-context` service. Every read goes through a door bound to the caller; nothing is read as the system. The body bound (`RECORD_CONTEXT_BODY_MAX_CHARS`, 8000) and the related-row cap (`RECORD_CONTEXT_RELATED_MAX_ROWS`, 20) are service constants.
- **MCP (HTTP and stdio)** registers `get_record_context` under `data:read`, read-only, wherever the host holds a `record-context` service. A host without it registers nothing new. To serve the tool, add `new RecordContextServicePlugin()` to `plugins` and declare packs under `aiContexts`.
