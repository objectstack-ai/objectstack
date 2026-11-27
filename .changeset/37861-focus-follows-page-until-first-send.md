---
'@objectstack/spec': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): a new chat conversation is about the record on the page until its first send, shown as a chip at the start of the composer's line; the pin and the offer to switch records are gone

Clause-②: yes (widening) — `@object-ui/plugin-chatbot` `ChatbotEnhanced` gains the optional `promptInputHeaderSlot`; `@object-ui/app-shell` `UseChatConversationReturn` gains `conversationMetadata`
Metadata-protocol: none
Removed locale keys (`@object-ui/i18n`, every pack): `console.ai.focus.pin`, `console.ai.focus.switchPrompt`, `console.ai.focus.switchAccept`, `console.ai.focus.switchDecline` — shipped only in 19 prereleases.

Framework ADR-0160 D6, seventh amendment ("The focus of a conversation"). Where the agent the chat runs declares `capabilities.focus: true`:

- **A conversation that has sent nothing is about the record on the page** (a record page, or a record open in a list's drawer). It follows the page with no prompt: another record is that record, and a list or a dashboard is no record, so the composer shows the page chip ("Viewing: X") there.
- **The chip sits inside the composer's frame, at the start of the line** (the right in Arabic): the object's icon, the record's name, and ×. × shows while the composer has focus or the pointer is over the chip, always on a touch screen, and has a 24px hit area. A record whose name cannot be read shows `object · id`.
- **× removes the focus and nothing adds it again** in that conversation, before or after the first send; the composer falls back to the page chip.
- **The first send fixes the focus**: that turn and every later one send it as `context.focus`, and navigation no longer changes it. A conversation sent without one never takes one.
- **A conversation opened again restores its own focus**: from this tab, or, in another tab or from history, from the `metadata.focus` its server row stores. The request body stays the authority.
- **Removed**: the pin on the page chip and the 「改为问《X》？」 offer to ask about another record, with their four locale keys (listed above). `console.ai.focus.pinned` now names the chip for assistive technology, and `.remove` labels ×.

Where the agent does not declare the flag, nothing changes: no chip, no `focus` key, and the page chip stays where it was.

`@object-ui/plugin-chatbot`: `ChatbotEnhanced` gains `promptInputHeaderSlot`, a row drawn inside the input's frame at the start of the line, in place of the `surfaceContextLabel` chip when given. `@object-ui/app-shell`: `useChatConversation` returns `conversationMetadata`, the `metadata` of the row it holds. `@objectstack/spec`: the `ToolExecutionContext.focus` docblock and the `capabilities.focus` description no longer speak of a pin; no key, type or gate changes.
