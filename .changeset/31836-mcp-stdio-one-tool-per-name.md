---
'@objectstack/mcp': patch
---

fix(mcp): the stdio transport boots when the AI tool registry already carries a native data tool name

Clause-②: no
Metadata-protocol: none

`MCPServerPlugin` bridges the AI service's tool registry onto the long-lived (stdio) server and then registers its own native data tools there. On a host whose registry already carried `list_objects` or another data tool name, the second registration threw `Tool list_objects is already registered` and the plugin's whole boot rolled back. Now one name is one tool: where both sources offer a name, the native data tool is served (the one HTTP `/api/v1/mcp` serves under that name, carrying the MCP grant and scope checks) and the registry tool of that name is not bridged, with one `debug` line naming it. The rule holds whichever of `bridgeTools` and `bridgeDataTools` runs first. A registry tool with no native namesake is bridged as before.
