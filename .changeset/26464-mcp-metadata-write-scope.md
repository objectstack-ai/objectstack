---
'@objectstack/spec': patch
'@objectstack/mcp': patch
---

feat(mcp): the HTTP MCP runtime bridges a host-injected authoring `ToolRegistry` behind a new `metadata:write` OAuth scope, with door provenance on every call

Clause-②: yes (widening)
Metadata-protocol: none

A developer driving an MCP client (Claude Code, Claude Desktop, …) against a hosted environment could read and run it over `/api/v1/mcp` but never build in it: `handleHttpRequest` served the data and action tools only, and no OAuth scope existed under which a token could even ask for authoring. This change adds the scope and its first reader.

- **`@objectstack/spec` — `MCP_OAUTH_SCOPE_METADATA_WRITE` (`metadata:write`)** joins `data:read`, `data:write` and `actions:execute` in `MCP_OAUTH_SCOPES`, so the authorization server advertises it and the runtime's up-front scope check admits it. It is a tool-surface grant, not a data grant: `scopesToAgentPermissionSets` maps it alone to the no-object-access floor, and beside a data scope it changes nothing about the data ceiling. **`MCP_OAUTH_SCOPE_CONSENT_COPY`** declares the one-sentence consent copy for every scope (the three existing sentences the Console already renders, plus the new one), keyed by `McpOauthScope` so a scope cannot be added without its sentence.
- **`@objectstack/mcp` — `handleHttpRequest(request, { authoring })`** accepts an optional `McpAuthoringInjection`: a host's `McpAuthoringToolRegistry` plus the token principal and the environment. Its tools appear in `tools/list` only when the request's `grantedScopes` names `metadata:write`; without the scope they are not registered, so `tools/call` on one is answered exactly as `create_record` is without `data:write` (the SDK's unknown-tool error, one mechanism). The undefined grant of an API key or a session is served no authoring tool: authoring follows the token's consent. Every call into the registry receives a fresh `McpAuthoringToolContext` — `door: 'mcp'` (`MCP_TOOL_DOOR`), `actor.id`, `principal`, `environmentId` — built from the host's inputs alone, so no request header can claim another door, user or environment. The runtime stays door-agnostic: which tools the host injects is the host's business.
- **`renderSkillMarkdown({ grantedScopes, authoringTools })`** renders a Build section naming the injected tools, with the build loop (create → verify → draft, a person publishes in the UI) and the switched frontmatter description `OBJECTSTACK_SKILL_DESCRIPTION_WITH_AUTHORING`, only under the same grant; every other render is byte-identical to before.
- **Unchanged.** The stdio transport's `bridgeTools` still calls its registry with one argument; the data and action tools register, refuse and answer as before. New exports: `MCP_TOOL_DOOR`, `grantsAuthoringTools`, and the types `McpToolDoor`, `McpTokenPrincipal`, `McpAuthoringToolContext`, `McpAuthoringToolRegistry`, `McpAuthoringInjection`.

What to do: nothing for an existing host. A host that wants the build door passes `authoring` to `handleHttpRequest` and `grantedScopes` / `authoringTools` to `renderSkill`.
