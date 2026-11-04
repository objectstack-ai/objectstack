---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/mcp': patch
---

feat(app-shell): Connect an Agent adds connect cards for WorkBuddy, Doubao Work and QwenWork, and drops the VS Code and Codex cards

Clause-②: no
Metadata-protocol: none

The Connect an Agent page (Account → Developer, and Setup) now carries three more client cards, each filled in with the deployment's MCP URL, listed after the claude.ai / Claude Desktop, Claude Code and Cursor cards:

- **WorkBuddy** — the `mcpServers` entry for Connectors → Custom connector → Configure MCP, with the `streamableHttp` transport spelling WorkBuddy reads, and the reminder that the connector stays inactive until it is trusted.
- **Doubao Work** — the name, transport and server URL to type into Skills · Connectors → New → New custom connector.
- **QwenWork** — the `mcpServers` JSON for Extensions → Connectors → Paste JSON config, with the `streamable-http` spelling QwenWork reads.

Each of the three names the fallback for a client version without the browser sign-in: the request header `Authorization: Bearer <API key>`. A minted key is now revealed in that form as well as the existing `x-api-key` line.

The VS Code / Copilot and Codex CLI cards are gone, with their strings `connectAgent.vscode.body` and `connectAgent.codex.body`; the generic `mcpServers` snippet on the Cursor card and the MCP URL at the top still serve any MCP client. The client cards form one list, with the API-key card on its own row below them. Long one-line snippets wrap instead of being clipped. New strings live under `connectAgent.fields`, `connectAgent.workbuddy`, `connectAgent.doubao` and `connectAgent.qwenwork`, translated in all ten packs. Nothing on the server changes; `@objectstack/mcp` updates only its description of the page.
