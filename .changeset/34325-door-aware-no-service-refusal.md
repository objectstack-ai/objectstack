---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

Clause-②: no
Metadata-protocol: none

The `no_confirmation_service` refusal (`428 ACTION_CONFIRMATION_REQUIRED`) of the MCP `run_action` and `resume_run` tools now names the route that works on the door that asked. On every door it says that a person performs the action in the app and that the same change must not be made with another tool. On the stdio door, for a client that did not advertise `elicitation`, it also says that a client that supports confirmation is asked in place on that server. The Streamable HTTP door, which asks no client, does not carry that sentence. The code, the status and `details` are unchanged. `McpActionCallDoor.elicitConfirmation` is now optional: the tools pass a door without an elicitor (`elicitsCapableClients: true`) for a stdio client without `elicitation`, so a bridge reads the elicitor before calling it.
