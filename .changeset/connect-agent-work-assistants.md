---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/mcp': patch
---

feat(app-shell): Connect an Agent adds connect cards for WorkBuddy, Doubao Work and QwenWork, and drops the VS Code card

Clause-②: no
Metadata-protocol: none

The Connect an Agent page (Account → Developer, and Setup) now carries three more client cards, each filled in with the deployment's MCP URL, listed after the Claude, Cursor and Codex cards:

- **WorkBuddy** — the `mcpServers` entry for Connectors → Custom connector → Configure MCP, with the `streamableHttp` transport spelling WorkBuddy reads, and the reminder that the connector stays inactive until it is trusted.
- **Doubao Work** — the name, transport and server URL to type into Skills · Connectors → New → New custom connector.
- **QwenWork** — the `mcpServers` JSON for Extensions → Connectors → Paste JSON config, with the `streamable-http` spelling QwenWork reads.

Each of the three names the fallback for a client version without the browser sign-in: the request header `Authorization: Bearer <API key>`. A minted key is now revealed in that form as well as the existing `x-api-key` line.

The claude.ai / Claude Desktop and Claude Code cards merge into one full-width Claude card with a half for each. The Codex CLI card becomes a Codex card for the Codex app: the name, transport and URL to enter under Settings → MCP servers → Add server, and where to sign in (new string `connectAgent.codex.hint`); it no longer shows a `config.toml` snippet. The VS Code / Copilot card is gone, with its string `connectAgent.vscode.body`; the generic `mcpServers` snippet on the Cursor card and the MCP URL at the top still serve any MCP client. The client cards and the API-key card form one list, the API-key card last. Long one-line snippets wrap instead of being clipped. The Doubao Work and QwenWork card titles are strings too (`connectAgent.doubao.title`, `connectAgent.qwenwork.title`), so the zh pack shows the products' own names, 豆包工作 and 千问办公. New strings live under `connectAgent.fields`, `connectAgent.workbuddy`, `connectAgent.doubao` and `connectAgent.qwenwork`, translated in all ten packs. Nothing on the server changes; `@objectstack/mcp` updates only its description of the page.
