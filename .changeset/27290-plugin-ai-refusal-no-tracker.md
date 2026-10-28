---
'@object-ui/types': patch
---

fix(types): the plugin-ai refusal messages no longer carry a tracker number

Clause-②: no
Metadata-protocol: none

The refusal for an `ai-form-assist`, `ai-recommendations` or `nl-query` node, and the message of the `@deprecated` `z.never()` names (`AIFormAssistSchema` and the rest under `@object-ui/types/zod`), no longer quote an issue number. They still name `@object-ui/plugin-ai` and the remedy. What they accept and refuse is unchanged. Nothing to do.
