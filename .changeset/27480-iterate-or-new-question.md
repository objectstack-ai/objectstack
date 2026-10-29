---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(plugin-chatbot): a plan that overlaps an existing app asks whether to extend it or build a new one, instead of offering Build it

Clause-②: yes (widening)
Metadata-protocol: none

When `propose_blueprint` finds that the plan overlaps an app the user already has, its result carries `decision: 'iterate_or_new'` and the overlapping app in `existingAppOverlap`. The chat used to draw that result as an ordinary plan card with a "Build it" button, so one click could build a duplicate of the existing app.

- **The question.** `detectProposedPlan` lifts the decision as `ProposedPlan.iterateOrNew`, with the app's `name` and `label` from `existingAppOverlap`. The plan card keeps its rows and, in place of "Build it" / "Adjust", asks whether to keep improving that app or build a separate one. Each of the two choices sends its answer as a chat message. A result that names no object still gets the question, never the fallback "Build it" card; an overlap that names no app gets the question without a name and a reply hint.
- **The answers follow the conversation.** `ChatbotEnhanced` takes two new optional props, `planExtendExistingMessage(app)` and `planBuildNewAppMessage`. The console resolves both by the conversation's language, like the plan card's other outbound messages (`console.ai.planExtendExistingMessage` and `console.ai.planBuildNewAppMessage`, in the `en` and `zh` packs only). Neither reads as approval to the confirm gate.
- **After a reload.** Server history re-parses the stored result. The message cache now writes `decision` and `existingAppOverlap` back into its compact plan envelope, so a cache-fallback reload asks the question too.
- **Labels.** `chatbot.plan.iterateOrNew.*` (question, choices, reply hint) in all ten packs.
