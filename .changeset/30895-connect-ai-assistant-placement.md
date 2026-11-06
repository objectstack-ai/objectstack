---
'@objectstack/mcp': patch
'@objectstack/platform-objects': patch
'@objectstack/runtime': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat: put Connect an AI Assistant where each person looks, and call it that

Clause-②: no
Metadata-protocol: none

The Connect an Agent page is now Connect an AI Assistant (连接 AI 助手, AI アシスタントを接続, Conectar un asistente de IA): the page title, its header and both of its navigation entries, in every shipped language. "Agent" already names the agents an author builds in Studio, and this page connects the AI assistant a person uses, such as Claude, Doubao or Cursor.

Where to find it:

- **Every signed-in person**: the avatar menu has a Connect an AI Assistant item, under Profile. In the Account app the entry has a group of its own, AI Assistant, open by default, instead of sitting inside the collapsed Developer group.
- **Platform administrators**: in Setup the entry is in the top group, Overview, under System Overview, instead of near the bottom of Integrations. Who sees it does not change: both groups need `manage_platform_settings`.

All three doors appear only where the MCP server is enabled; with `OS_MCP_SERVER_ENABLED=false` the page, both menu entries and the avatar item are absent. The page address (`page/connect_agent`) and the nav item id (`nav_connect_agent`) are unchanged, so bookmarks and links keep working. The stdio start-up refusal and the API-key session refusal name the new page and paths.
