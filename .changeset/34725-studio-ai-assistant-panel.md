---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(studio): the Studio AI panel matches the console's AI assistant

Clause-②: yes (widening — new studio-namespace locale keys, and one optional `columnMarks` member on the published `GridFieldAuthoring` interface of @object-ui/components)
Metadata-protocol: none

The AI panel on Studio's right side now looks and works like the console's AI assistant drawer.

- It is called "AI Assistant" (「AI 助手」) everywhere, including the line that says which tool drafted a change.
- Studio's top bar shows the console's robot button in the same place. It shows or hides the right panel and always opens it on the AI assistant. `⌘.` still switches between properties and the assistant. Without an assistant, the panel icon stays.
- The panel has one header row: the Properties | AI Assistant switch on the left; History, widen and Close on the right. Usage and Share moved into the History view, which covers the chat and lists earlier conversations with New chat.
- The panel opens 420 px wide, like the console drawer. It can be dragged or keyed wider from its left edge and remembers the width under its own key. On a small screen it stays an overlay. Studio's top bar now names its pillars by its own width rather than the window's, so a wide panel never pushes the robot under it.
- The chip above the composer reads "Viewing: <object label> · <view>" (「正在看：会议 · 记录」), never the internal name.
- On the Data canvas, the fields the AI assistant changed in the pending draft carry a draft chip on their records-grid column header and on their Form card. A line above the canvas says "The AI assistant just made N changes", with Review, which opens the pending changes, and "Discard all unpublished changes", which discards the package's drafts after a confirm.

`@object-ui/components`: `GridFieldAuthoring` takes an optional `columnMarks`, a node per accessorKey that `data-table` draws after the column's header label.

`@object-ui/i18n`: new studio keys `engine.studio.slot.history`, `engine.studio.slot.resize` and `engine.studio.copilotChanges.*`. Changed values: `engine.studio.aiCopilot` and `engine.studio.draftMark.agent.copilot` (AI Assistant), `console.ai.discussing` (Viewing / 正在看, in every pack), and `draftedByCopilot` (AI assistant). No key was removed. Studio no longer reads `engine.studio.slot.openFullPage`.
