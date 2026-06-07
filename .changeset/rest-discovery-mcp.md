---
'@objectstack/rest': patch
---

fix(rest): advertise `routes.mcp` in /discovery when MCP is enabled (cloud#152)

The objectui Integrations page reads `discovery.routes.mcp` to show the "Connect
an AI agent" card, but it stayed absent on live envs even with MCP enabled. Root
cause (NOT a cache, as first suspected): `@objectstack/rest` serves its OWN
`/discovery` (`protocol.getDiscovery()`), separate from the dispatcher's
`getDiscoveryInfo` where the `mcp` field was added — so the REST-served discovery
never advertised it.

The REST discovery handler now adds `routes.mcp` (pointing at the unscoped
`/api/v1/mcp`, since the MCP route is mounted bare) when
`OS_MCP_SERVER_ENABLED=true`, and omits it otherwise — mirroring the dispatcher
discovery and the opt-in gate. 2 tests (enabled → advertised, disabled → absent).
