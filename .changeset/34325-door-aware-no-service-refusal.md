---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

The `no_confirmation_service` refusal (`428 ACTION_CONFIRMATION_REQUIRED`) of the MCP `run_action` and `resume_run` tools now names the route that works on the door that asked. On every door it says that a person performs the action in the app and that the same change must not be made with another tool. On the stdio door, for a client that did not advertise `elicitation`, it also says that a client that supports confirmation is asked in place on that server. The Streamable HTTP door, which asks no client, does not carry that sentence. The code, the status and `details` are unchanged. No type is made optional: `McpActionCallDoor` is unchanged, and it is still passed only when the client can be elicited. The added, optional surface is a new exported type `McpActionCallDoorFacts` (`{ elicitsCapableClients?: true }`) and an optional fourth parameter `facts` on `McpActionBridge.runAction` and `resumeRun`. The tools pass it, after an `undefined` door, only for a stdio client without `elicitation`. A bridge that does not read it compiles and answers as before.
