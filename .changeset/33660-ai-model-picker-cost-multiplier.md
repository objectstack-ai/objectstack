---
'@objectstack/spec': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

feat(spec, plugin-chatbot, console): the AI model picker shows each model's cost multiplier, notes the allowance left, and asks before a ×20 pick

Clause-②: yes (widening) — `@objectstack/spec` `AiModelsResponseSchema`'s model entry gains an optional `costMultiplier` (a positive number; the environment's default model is 1). `@object-ui/plugin-chatbot` `ChatbotModelOption` gains an optional `costMultiplier`, and `ChatbotEnhanced` an optional prop `allowanceUsedFraction`. Nothing is removed or narrowed; the bare-string model entry stays.
Metadata-protocol: none

- **The multiplier, at the moment of choice.** `GET /api/v1/ai/models` may now say, per model, how much one message draws on the AI allowance compared with the default model. The composer's model picker draws it as `×N` beside the model's label, in the list and on the picker itself. A model whose entry carries no multiplier shows none.
- **The allowance left.** When the environment serves `GET /api/v1/ai/usage`, the open list notes the share of the allowance left and that a `×N` model uses it N times as fast. It is a share, never a token count. Without usage the multipliers show alone.
- **A pick at ×20 or above asks once.** The confirmation names the model and its multiplier (and the share left, when known); Cancel keeps the current model, and a pick below ×20 applies at once as before. The question lives in the shared picker, so the full-page AI chat, the console chat dock and the Studio copilot all ask it.
- The multiplier is filled by the AI service that answers `/ai/models` (cloud `service-ai`); until it does, the picker looks as it did.
