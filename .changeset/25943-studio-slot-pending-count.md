---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(studio): the right slot counts the copilot's items awaiting confirmation, 「AI 副驾 · N 项待确认」

Clause-②: yes (widening)
Metadata-protocol: none

Studio's right slot used to say only that "a plan awaits your approval", and only for a build plan. The copilot's change plan (the 「修改方案 · N 项」 card it proposes for an app that already exists) did not light it at all. Now:

- **The count.** The copilot tab of the slot's 属性 | AI 副驾 header carries a badge with the number of items awaiting confirmation, and while the properties show, the folded copilot strip at the slot's foot reads 「AI 副驾 · N 项待确认 · 回到对话 →」 (en: "AI copilot · N awaiting your approval"). The number is the rows of the newest change plan, or 1 for a build plan. The badge and the strip go away the moment the author clicks 存为草稿 / Confirm or Build it, or the change lands.
- **A change plan is a proposal.** The chat's reading of "the newest proposal still waits for the user" now includes a change plan whose card still offers its confirm button, not only a build plan whose card offers "Build it". The console's chat launchers (the FAB and the ChatDock edge launcher) therefore also show their waiting marker while a change plan awaits confirmation.

`@object-ui/plugin-chatbot`: the `onPlanApprovalPendingChange` prop on `ChatbotEnhancedProps` now receives a second argument, `count: number` (the items the newest proposal asks the user to confirm; 0 when nothing is pending), and it fires when either value changes. A host that reads only the first argument is unaffected. The boolean now also reads `true` for a pending change plan (see above).

`@object-ui/i18n`: the `studio` namespace gains `engine.studio.slot.pendingCount` (en and zh, interpolates `count`). No key is removed or renamed; `engine.studio.slot.planPending` stays in the table.
