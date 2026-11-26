---
'@objectstack/spec': patch
'@object-ui/plugin-chatbot': patch
---

feat(spec, plugin-chatbot): an AI model entry may carry its tier name, and the closed model picker shows it alone

Clause-②: yes
Metadata-protocol: none

- **`AiModelsResponseSchema`** (`@objectstack/spec`): the model entry gains an optional `tierLabel`, a non-empty string naming the model's tier alone (for example `Fast`), in the language the response is served in. Nothing is removed or narrowed; the bare-string model entry stays, and an entry without `tierLabel` parses as before.
- **The closed model picker** (`@object-ui/plugin-chatbot`, so the full-page AI chat, the console chat dock and the Studio copilot): when the model in force carries a `tierLabel`, the closed picker reads that tier name only, instead of the longer `label` that may also name the model (`Fast · Claude Haiku 5.5`). The full `label` stays the picker's tooltip and the text of its row in the open list, where the choice is made. A model without one shows its `label`, as before. `ChatbotModelOption` gains the optional `tierLabel`, and `useAiModels` keeps a served `tierLabel` only when it is a non-empty string.
- The tier name is filled by the AI service that answers `GET /api/v1/ai/models` (cloud `service-ai`); until it does, the picker looks as it does today.
