---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
---

The agent metadata form now offers `structuredOutput`, the output contract the cloud AI runtime enforces on every final answer. It is a `composite` row in the AI Configuration section, spelled like the `memory` and `guardrails` rows: Studio derives its seven sub-rows from the served JSON Schema.

Clause-②: no

- Before this, the block had no row on the agent form, so the only way to author it in Studio was the Source tab. The form's reconciliation test excused that with a ledger row saying the key was declared but not enforced. The key has been enforced since the structured-output enforcement landed (liveness `live`), and that row is gone.
- What Studio renders, read in the console's metadata form renderer: `format` and `fallbackFormat` are selects over `json_object` / `json_schema`. `strict` and `retryOnValidationFailure` are switches, and `maxRetries` is a number. `transformPipeline` is a multi-select over `trim` / `parse_json` / `validate`. `schema`, the free-form JSON Schema record, is a JSON text editor: the stored value is shown as JSON and saved back as parsed. That is the same editor the action form already gives `ai.outputSchema`, which is the other slot this JSON Schema rule governs.
- Two editing limits of those controls. A multi-select toggle stores the steps in the order the enum declares them (`trim`, `parse_json`, `validate`). And the schema editor keeps the last valid JSON while the text does not parse. A value nobody edits is saved back unchanged.
- No schema, parse or export change. The accept set of `AgentSchema` is unchanged, and so is the refusal of an untyped JSON subschema at `structuredOutput.schema`. What moves is the form payload `getMetaTypes()` serves, and the two new leaves of the `platform-objects` metadata-form catalogs (the row's label and help text). Those are authored in `zh-CN`, `ja-JP` and `es-ES`, not left as copies of the English source.
