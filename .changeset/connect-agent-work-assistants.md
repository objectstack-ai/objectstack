---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/mcp': patch
---

feat(app-shell): Connect an Agent adds connect cards for WorkBuddy, Doubao Work, DuMate and QwenWork, and groups the page by how the client is used

Clause-②: no
Metadata-protocol: none

The Connect an Agent page (Account → Developer, and Setup) now carries four more client cards, each filled in with the deployment's MCP URL:

- **WorkBuddy** — the `mcpServers` entry for Connectors → Custom connector → Configure MCP, with the `streamableHttp` transport spelling WorkBuddy reads, and the reminder that the connector stays inactive until it is trusted.
- **Doubao Work** — the name, transport and server URL to type into Skills · Connectors → New → New custom connector.
- **DuMate** — the name, transport and URL for a custom MCP app under Connected apps, with where to choose OAuth or token auth.
- **QwenWork** — the `mcpServers` JSON for Extensions → Connectors → Paste JSON config, with the `streamable-http` spelling QwenWork reads.

Each card names the fallback for a client version without the browser sign-in: the request header `Authorization: Bearer <API key>`. A minted key is now revealed in that form as well as the existing `x-api-key` line.

The page is grouped into Work assistants (claude.ai / Claude Desktop and the four above) and Coding agents (Claude Code, Cursor, VS Code, Codex), with the API-key card on its own below them. Long one-line snippets wrap instead of being clipped. New strings live under `connectAgent.sections`, `connectAgent.fields`, `connectAgent.workbuddy`, `connectAgent.doubao`, `connectAgent.dumate` and `connectAgent.qwenwork`, translated in all ten packs. Nothing on the server changes; `@objectstack/mcp` updates only its description of the page.
