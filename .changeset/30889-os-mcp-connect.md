---
'@objectstack/cli': patch
---

feat(cli): `os mcp connect` registers your environment's MCP server with Claude Code in one command

Clause-②: no
Metadata-protocol: none

`os mcp connect` finds the environment `os deploy` deploys to (`--env`, then the active environment for this control plane, then your organization's only one; several with no `--env` is refused, as deploy refuses) and runs `claude mcp add --transport http NAME https://ENV-HOST/api/v1/mcp`. The server is named after the environment (its slug, else its display name, else its id), so several environments can be registered side by side; `--name` overrides it.

- `--print` prints the endpoint and the `claude mcp add` line and runs nothing. For any other MCP client, add that endpoint as a remote HTTP MCP server in the client's own settings.
- `--url http://localhost:3000` connects a self-hosted or local server instead, named `objectstack` like the `os dev` banner's Connect row. The banner now prints its line through the same builder, so the two stay one spelling.
- No token is stored or handed to the client. Claude Code runs the environment's own OAuth: run `/mcp` in Claude Code and the browser shows the environment's sign-in and consent. The command prints where to revoke that grant (Account → Connect an AI Assistant in the environment's console).
