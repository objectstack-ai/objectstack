---
'@objectstack/runtime': patch
---

Export `dispatchAction(kernel, request)` (with `ActionDispatchRequest`, `ActionDispatchAnswer` and `ActionDispatchPosture`): the REST `/actions` door's admission and dispatch as a function, so a host's own action door (an in-product AI tool, a job runner) answers what that door answers instead of keeping a second copy of its rules. `posture: 'ai'` adds the MCP `run_action` tool's rules (`sys_*` exposure, `ai.exposed`, `ai.requiresConfirmation`); `namespace` addresses an installed package's action as the addressed REST path does. A host call writes its invocation row without a `surface`.

The REST door, the host export and MCP `run_action` now run one admitted sequence (`action-dispatch.ts`). The REST door's answers are unchanged. MCP `run_action` refusals that change (each was refused before and stays refused; nothing new runs):

- C3: a name nothing declares is `404 RESOURCE_NOT_FOUND` with the REST door's sentence (was an uncoded 400 "not found").
- C4: a flow action with no automation service is `503 SERVICE_UNAVAILABLE` (was 400).
- C5: a client-side action whose caller lacks its capability is `403 PERMISSION_DENIED`, and one the installation switched off is `409 ACTION_DISABLED` (was 400, the type check ran before both).
- C6: an entitled client-side action keeps its 400 with the REST door's type prescription; one never exposed to AI is refused at the exposure gate first.
- C7: a flow run that failed (`400 FLOW_FAILED`) carries the run `details` the REST door serves.
- R1: an object whose package is disabled is `404 OBJECT_PACKAGE_DISABLED`, bare and addressed (was 400 / `404 RESOURCE_NOT_FOUND`).

One narrowing, at the MCP action bridge below the published tool: an array `params` is refused `400 VALIDATION_FAILED` before anything runs (it ran before, spread into numeric keys). The `run_action` tool's input schema already refused an array, so no first-party caller changes.

Clause-②: yes (narrowing)
Metadata-protocol: none
