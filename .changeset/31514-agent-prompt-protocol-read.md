---
'@objectstack/mcp': patch
---

fix(mcp): `agent_prompt` reads an agent through the protocol read `GET /api/v1/meta/agent/NAME` serves, so an agent a package ships is advertised and served

Clause-②: yes (widening)
Metadata-protocol: none

The stdio MCP server's `agent_prompt` read agents from the kernel `metadata` service, which holds no copy of an agent a package ships (it lives in the registry the protocol reads). So a boot whose only agent came from a package did not list `agent_prompt`, and a get could not serve that agent, while `GET /api/v1/meta/agent/NAME` served it. Now, where the host has the `protocol` service, `agent_prompt` resolves the agent through its by-name read (`getMetaItem`) and the roster that decides whether the prompt is advertised reads its merged listing (`getMetaItems`), with the metadata service's completeness verdict kept on top as for skill prompts. One reader per host: a host without the protocol reads the metadata service exactly as before. A miss still answers `Error: Agent "X" not found`, and a by-name read refused `SERVICE_UNAVAILABLE` still answers the outage text with no instructions.

`McpMergedMetadataRead`, the type of `MCPServerRuntime.bridgePrompts`' second parameter, gains an optional `getMetaItem(request)` member; a host that passes an object without it is read as before.
