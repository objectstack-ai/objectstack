---
'@object-ui/app-shell': patch
---

refactor(app-shell): split the AI chat page into modules, with no change in behaviour

Clause-②: no
Metadata-protocol: none

`console/ai/AiChatPage.tsx` keeps the page itself (`AiChatPage`, `AiChatPageProps`); the rest moved, byte for byte, into six modules beside it: `ChatPane.tsx` (the conversation column), `aiChatHydration.ts` (stored history to rendered messages), `aiChatLinks.ts` (the list and record addresses the chat opens), `useDeferredFirstSend.ts` (the held first send and the composer draft hand-off across the pane's remount), `aiChatChrome.ts` (the collapsible conversations list, its shortcuts and the collapse-to-dock landing) and `agentCopy.ts` (agent labels, empty state and starter suggestions). Every name the page exported is still exported from `AiChatPage.js` by name, and the package entry is unchanged, so no import changes.
