---
'@objectstack/runtime': patch
---

fix(runtime): `dispatchAction` places its call the way the REST door places a scoped request, and its `ai` posture answers the type refusal with the AI door's own sentence

Clause-②: no
Metadata-protocol: none

- **Kernel scope.** `dispatchAction(kernel, { environmentId, … })` now runs the dispatcher's own environment-and-kernel step (the first half of `resolveRequestScope`), asked the path `POST /environments/:environmentId/actions/...` would ask. On a multi-kernel host the host's `kernel-resolver` places the call on the environment's own kernel, exactly as it places the REST request. A resolver that throws now refuses the call with the status it carries, instead of the call running on the host kernel. Pass the kernel your HTTP door is served from (on a multi-kernel host, the one that registers `kernel-resolver`). Single-kernel hosts answer as before.
- **`ai` posture.** A client-side action or an off-origin `type: 'api'` action is still refused `400` at the same point, but under `posture: 'ai'` (and through MCP `run_action`) the sentence is the AI door's — `Action 'NAME' (type='TYPE') cannot be invoked via MCP` — instead of the REST caller's prescription, which named the action's `target` ("Call TARGET directly"). The `rest` posture and the REST door keep the prescription.
