---
'@object-ui/plugin-chatbot': patch
---

refactor(plugin-chatbot): move ChatbotEnhanced's types, subcomponents and helpers into `src/chat/`

Clause-②: no
Metadata-protocol: none

A move-only split of `ChatbotEnhanced.tsx` with no behaviour change. Its types, the model picker, the liveness and thinking indicators, the tool summaries, the answer layout, the record-write card helpers and the composer notices now live in seven modules under `src/chat/`. `ChatbotEnhanced.tsx` keeps the component and re-exports by name every symbol it exported before, so every import path still works. The package entry points (`index.tsx`, `core.ts`) are unchanged, and so is the published API.
