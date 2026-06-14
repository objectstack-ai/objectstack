---
"@objectstack/service-ai": patch
"@objectstack/spec": patch
---

fix(service-ai): resolve the current object for AI chat across languages

The console assistant reported "can't find the X object" when asked to analyse
the object on the current page — most visibly for non-English prompts. Three
compounding gaps fixed:

- `SchemaRetriever.tokenise()` dropped all CJK text, so a Chinese request
  yielded zero terms; it now emits CJK single-char + bigram terms.
- Nothing fed the current object's schema to the agent, so "this object" could
  not be resolved without a lucky keyword hit. `AgentRuntime.buildContextSchema
  Messages()` now injects the current object's schema into the system prompt and
  both chat routes call it.
- `ToolExecutionContext` (and the `ai-service` spec contract) gains
  `currentObjectName`/`currentViewName`; routes thread them through and
  `query_data` falls back to the current object when keyword retrieval is empty
  (so the open edition, which lacks `describe_object`/`list_objects`, still
  resolves the page's object).
