---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/mcp': patch
'@objectstack/platform-objects': patch
---

feat(console): Connect an AI Assistant names the connected assistant and its last call; plain-words page subtitle

Clause-②: no
Metadata-protocol: none

- **`@object-ui/app-shell`**: once the signed-in person has connected, the line under the example requests on Connect an AI Assistant names what is connected and when it last made a call, the most recent call first: an authorized assistant by its name, with its last call "in the hour from" the recorded hour, or an API key by its name, with its last call as a moment; "no call yet" when none is recorded, and a pointer to the list at the bottom when more than one is connected. With nothing connected (or when it cannot be read) the line stays the try-first hint. It reads the records the "What can act as you" list reads (`oauth.authorizedClients.list()` and the person's own `sys_api_key` rows; a revoked or expired key is not a connection) through one hook, `useConnectedAccess`, and follows a Revoke made on the page.
- **`@object-ui/i18n`**: `connectAgent.capabilities.connected`, `connectedKey`, `lastCallHour`, `lastCallAt`, `noCallYet` and `moreConnected` added in all eleven packs.
- **`@objectstack/mcp`**: the Connect an AI Assistant page header no longer speaks of MCP-capable clients or row-level security: "Work in this system from Claude, Doubao and other AI assistants. Each one acts as you: it sees and changes only what your own permissions allow."
- **`@objectstack/platform-objects`**: `pages.connect_agent.subtitle` follows in en, es-ES, ja-JP, zh-CN and zh-Hant, with the source digests re-recorded.
