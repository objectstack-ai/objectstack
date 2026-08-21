---
'@objectstack/spec': minor
---

Add an optional `sharingModel` slot (enum `private | public_read | public_read_write | controlled_by_parent`) to `BlueprintObjectSchema` and, as a required-but-nullable key, to the OpenAI-strict structured-output mirror (`SolutionBlueprintStrictSchema`). The propose-stage LLM can now author a deliberate Org-Wide Default (OWD) choice — e.g. `private` for an object the user described as personal/sensitive — instead of having the platform's deterministic default silently override the intent expressed at propose time. Omitting the key (or emitting `null` in the strict mirror) still defers to the platform default (business object → `public_read_write`, master-detail child → `controlled_by_parent`).
