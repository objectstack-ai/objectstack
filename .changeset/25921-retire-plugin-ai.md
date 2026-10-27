---
"@object-ui/types": minor
"@object-ui/i18n": minor
"@object-ui/cli": minor
---

refactor(ui)!: retire `@object-ui/plugin-ai` and its three node types

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-ai#AIFormAssist, @object-ui/plugin-ai#AIRecommendations, @object-ui/plugin-ai#NLQueryInput) the retired operands are React components of a published ui package that nothing in the workspace loaded; no packages/spec schema, no ADR-0087 conversion surface and no stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite, and the three node literals are refused by name on the zod face -->

**BREAKING.** `@object-ui/plugin-ai` is retired: `18.2.0` is its last published version, and it gets no further release. The console registered it neither eagerly nor lazily and no workspace package imported it, so the `ai-form-assist`, `ai-recommendations` and `nl-query` node types it registered rendered nowhere in the product.

What leaves, and what to do:

- FROM `AIFormAssist` TO nothing: drop the `@object-ui/plugin-ai` import and dependency. A host that still wants the component keeps its own copy and registers it under its own type key.
- FROM `AIRecommendations` TO nothing: the same fix.
- FROM `NLQueryInput` TO nothing: the same fix.
- Page nodes of type `ai-form-assist`, `ai-recommendations` or `nl-query`: remove them from the page. `safeValidateSchema` and `objectui validate` now refuse each of the three literals by name at `type`, with that remedy; before, the page rendered the "Unknown component type" panel in their place whenever the package was not loaded.
- `@object-ui/types`: `AIFormAssistSchema`, `AIRecommendationsSchema`, `NLQuerySchema`, `AIConfig`, `AIFieldSuggestion`, `AIRecommendationItem`, `NLQueryResult`, `AIProvider` and `AIModelType` are `@deprecated` and now `never`, and `AnySchema` has no member for the three literals. The zod names (`AIFormAssistSchema` and the rest under `@object-ui/types/zod`, `AIComponentSchema` included) are `@deprecated` `z.never()` schemas that accept nothing. Remove every reference. The names stay importable until the tombstone sunset rule decides when they leave the published face.
- `@object-ui/i18n`: the `ai.*` message block (`ai.nlQuery.*`, `ai.formAssist.*`, `ai.recommendations.*`) is gone from all ten packs. A host that registered overrides for those keys can delete them.
- `@object-ui/cli`: `objectui check` no longer lists the three literals as known component types.
