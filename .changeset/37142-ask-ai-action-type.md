---
'@objectstack/spec': minor
'@objectstack/runtime': patch
'@object-ui/core': minor
'@object-ui/react': minor
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': minor
---

feat(actions): `type: 'ask_ai'` — an action that opens the in-app assistant focused on the record it runs on

Clause-②: yes (widening: a new `ActionType` member `ask_ai`, refused beside `target`, `ai.exposed: true` and on a dashboard header)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-ui/SKILL.md, skills/objectstack-ai/SKILL.md

ADR-0160 D7. An author can now put an "Ask AI" button on a record:

```ts
actions: [{ name: 'ask_about_account', label: 'Ask AI', type: 'ask_ai', locations: ['record_header'] }]
```

- **Spec.** `ActionType` gains `ask_ai`. It takes no `target`: the parse refuses one (and its inline spelling `to`) at the `target` path, because what the assistant reads about the record is chosen by the record's context pack, not by the action. It is never an AI tool: `ai.exposed: true` beside it is refused at `ai.exposed` (`false` parses). A dashboard header action cannot be `actionType: 'ask_ai'` (a header runs on no record); `WidgetActionTypeSchema` stays derived from `ActionType` and the header refuses that one member with the reason.
- **Runtime.** `ask_ai` has no server dispatch. `isHeadlessInvokableAction` answers `false` for it, so MCP `list_actions` skips it and the AI action door refuses it, and the REST action door answers with a sentence about the in-app assistant.
- **Console.** A click focuses the in-app assistant on the record (`setChatFocus`) and opens the drawer. It sends no message and makes no server call. The record is the page record, the row a row surface hands over, or the one selected row; with none, or several selected, the click is refused before any `confirmText`. New in `@object-ui/core`: `ActionRunner.setAssistantFocusHandler`, `ActionRunner.drawsAction`, `isAskAiAction`, and the `AssistantFocus` / `AssistantFocusHandler` types; `ActionEngine` leaves undrawn actions out of `getActionsForLocation` and `getBulkActions`. New in `@object-ui/react`: `<ActionProvider onAskAi>` and `useDrawsAction()`. `@object-ui/app-shell` installs the handler (`useAskAiHandler`) only when the layout hosts the assistant drawer, the AI surface is on, and an agent in the catalog advertises `capabilities.focus`.
- **Absent, not disabled.** Where no in-app assistant can take it, an `ask_ai` action is not drawn on any action surface (record header, action bars, row menus, related lists, bulk bar, page action renderers). A launch that reaches the runner anyway is refused, not reported done.
