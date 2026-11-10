---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): a build turn with several `propose_blueprint` results draws one "Proposed plan" card, the newest

Clause-②: no
Metadata-protocol: none

When the model called `propose_blueprint` more than once in one turn, `ChatbotEnhanced` drew a "Proposed plan" card for every result, each with its own "Build it" button, although the runtime builds only the newest plan. It now draws the newest plan of each turn as the card and the earlier plans of that turn as completed steps. A turn is everything after a user message up to the next one, read across messages, so the rule holds on the live stream (one message per turn) and on reloaded history, server or cache (one message per step). A plan from an earlier turn keeps its card. The new `supersededPlanIds` helper in `mapMessages.ts` holds the rule; it is not exported from the package entry.
