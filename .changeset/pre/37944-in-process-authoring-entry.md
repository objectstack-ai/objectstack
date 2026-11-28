---
'@objectstack/runtime': patch
---

feat(runtime): an in-process entry to the light authoring door, for a host's own AI assistant

Clause-②: no
Metadata-protocol: none

`createInProcessAuthoringRegistry(kernel, { executionContext, environmentId })` returns the five tools the MCP draft door serves (`list_metadata_items`, `get_metadata_item`, `list_drafts`, `save_metadata_draft`, `delete_metadata_draft`) for an AI assistant that runs in the server process and acts as the signed-in person, such as a host's in-app ask turn. It is built by the MCP door's own assembly, over a request placed the way `dispatchAction` places a host's action call, so the tool definitions, the read gates, the writer and the publish verdicts are the MCP door's, with no second copy.

- **Admission** is the person's own `manage_metadata`, read from their grants exactly as the MCP door reads the human half. There is no OAuth scope to hold: the host's authenticated session takes its place. A person without the capability is listed no tool and every call is refused `403 PERMISSION_DENIED`, the MCP door's shape. An envelope with no user, a system envelope, or a grant read that fails admits nothing.
- **Saves state `surface: 'copilot'`** (an AI assistant's tool writing on a person's behalf), never `mcp`, and no OAuth `client`, so Studio's draft marks and per-key provenance tell an in-app save from an MCP one.
- **No publish tool**: drafts stay for a person to review and publish in Studio.
- **The MCP door is unchanged**: same tools, same admission, same `surface: 'mcp'` saves with the token's client.

The host keeps the same jobs `dispatchAction` leaves it: authenticating the person, the authentication-policy gate and the environment-membership gate. A `kernel-resolver` that refuses to place the request rejects the call.
