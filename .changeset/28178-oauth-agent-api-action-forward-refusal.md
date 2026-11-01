---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(runtime): an agent connected over OAuth is refused by name before an api action's forward, and `list_actions` marks such an action instead of the target answering it as anonymous

Clause-②: yes (widening: a listed action gains the optional `unavailable: { code, reason }` member, `McpActionSummary.unavailable`, with the new `McpActionUnavailable` type export; every existing member keeps its value)
Metadata-protocol: none
Ruling-ref: #28178 ruling `6540286612`, option B

A same-origin `type: 'api'` action is forwarded by the action doors (MCP `run_action` and `POST /actions/:object/:action`) with the caller's own credentials. An agent connected to MCP over OAuth holds an access token that the platform honours on the MCP endpoint only, so the forward reached every other target as nobody, and the agent got the target's anonymous `401` ("Authentication is required…", "Sign in first") although it had authenticated.

- **Now.** One table of credential kind × target door decides what the forward can carry: an identity route (`/api/v1/auth/…`) accepts a signed-in session only, the MCP endpoint a session, an API key or an OAuth token, every other target a session or an API key. A caller whose credential the target cannot read is refused before the forward with `401` and the standard `UNAUTHENTICATED` code, and a sentence naming the action, its target and what would let it run. Nothing is run.
- **`list_actions`.** Such an action is still listed, with `unavailable: { code, reason }`: the code and the sentence `run_action` would answer, so an agent can tell its user why it cannot run it.
- **Same table, earlier lane.** The API-key refusal on an identity route (#28217) is now one cell of that table; its sentence is unchanged, and `list_actions` marks it for an API-key caller too.
- **Unchanged.** Where an OAuth access token is accepted (the MCP endpoint only), which credentials any target accepts, and every forward the table allows. A server-built forward credential that would let an OAuth agent run these actions is a separate decision (#28367).
