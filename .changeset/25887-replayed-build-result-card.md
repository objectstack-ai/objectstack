---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
---

fix(plugin-chatbot,app-shell): a whole-app build approved from the proposed plan draws its result card, live and after a reload

Clause-②: no
Metadata-protocol: none

Approving a proposed plan sends the approval sentence, and the runtime replays the approved `apply_blueprint` under a `replay_` tool-call id. The chat read every replay result as the verdict of a confirm card and dropped its draft review, and a replay streams no build-progress frames, so the build's own envelope (`drafted[]`, `packageId`, `checklist`, `nextSteps`) reached the chat and was drawn nowhere: no result card, no Open app, no checklist, no next steps.

- **`@object-ui/plugin-chatbot`:** a replayed whole-app build that drafted keeps its draft review and draws the same result card as a model-driven build. A replayed build in an auto-publish environment (`status: 'published'`) draws the card and its next steps from that envelope; so does a published build after a reload. A replay whose publish rolled back, and a replayed incremental edit, are unchanged.
- **`@object-ui/app-shell`:** the AI chat page's hydration keeps the same draft review, so a reloaded thread binds to the package the replay built, and the conversation cache keeps that build's draft envelope instead of the bare replay verdict.

What to do: nothing.
