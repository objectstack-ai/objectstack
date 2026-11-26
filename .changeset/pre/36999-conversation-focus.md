---
'@objectstack/spec': minor
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): a chat conversation can be pinned to one record — sent as `context.focus` on every turn, shown as a chip in the composer, kept across navigation — where the agent declares `capabilities.focus`

Clause-②: yes
Metadata-protocol: added

**Contract (`@objectstack/spec`).** `ToolExecutionContext` gains `focus?: { object: string; id: string }[]`, beside `surfaceContext`: the record(s) the conversation is pinned to, as the client reports them on every turn. Client-reported and advisory, never an access decision; a consumer re-reads the record as the caller. At most one entry in phase 1. The agent catalog row (`AiAgentCapabilitiesSchema`, `GET /api/v1/ai/agents`) gains an optional `capabilities.focus: boolean`: an agent that honours the focus says so, and an absent flag reads as false. Both are additions; nothing is removed or renamed, and every catalog row served before the flag still parses.

**Console (`@object-ui/app-shell`, `@object-ui/plugin-chatbot`, `@object-ui/i18n`).** Where the agent the chat runs declares `capabilities.focus: true`:

- The composer's page chip is drawn in the row above the input (where the drafts line sits) instead of on the input's top edge, and carries a pin when the page shows one record (a record page, or a record open in a list's drawer). Pinning makes every later turn send `context.focus: [{ object, id }]`, the first turn of a new conversation included, until the user removes it with the chip's remove control.
- The pinned record's chip replaces the page chip and names the record by its display name, read in the browser as the user; a record the user cannot read keeps its `object · id` pair.
- Opening another record while one is pinned asks once whether to ask about that one instead; a decline is remembered for the conversation.
- The focus belongs to the conversation: it never changes which conversation the drawer shows, and it is restored when that conversation is shown again in the same tab.
- `setChatFocus({ object, id })` (exported from `@object-ui/app-shell`) is the setter every entry point pins through.

Where the agent does not declare the flag — every server today — nothing changes: no pin, no chip, no `focus` key in the request, and the page chip stays where it was. `AgentCapabilities` in `@object-ui/plugin-chatbot` gains `focus`, read from the catalog; unlike the build-era capabilities it has no name-based fallback for older servers. New locale keys `console.ai.focus.pin`, `.pinned`, `.remove`, `.switchPrompt`, `.switchAccept` and `.switchDecline`, in every pack.
