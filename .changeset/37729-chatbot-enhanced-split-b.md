---
'@object-ui/plugin-chatbot': patch
---

refactor(plugin-chatbot): move `ChatbotEnhanced`'s tool-card renderer into `src/chat/toolDetail.tsx`

Clause-②: no
Metadata-protocol: none

A move-only split of `ChatbotEnhanced.tsx` with no behaviour change. The detailed tool card (`renderToolDetail`: the collapsible tool header and payload, the decision line, and the sample-data cleanup, package removal, record write and record hand-off cards) is now a module-level function in `src/chat/toolDetail.tsx` that the component calls with one context object. The rendered element tree is unchanged, and so are the package entry points (`index.tsx`, `core.ts`) and the published API.
