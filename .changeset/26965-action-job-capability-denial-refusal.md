---
'@objectstack/runtime': patch
---

fix(runtime): an action or job body refused for a missing capability answers the same coded 403 a hook body does, not a bare 500 (#26965)

Clause-②: no
Metadata-protocol: none

**What was wrong.** Since #26903 a hook body that calls something its `body.capabilities` does not grant is refused `403 INSUFFICIENT_PRIVILEGES`, naming the hook, the capability and the remedy. The same call from an action body (for example `ctx.api.object('note').find(...)` without `api.read`) still answered `POST /api/v1/actions/OBJECT/ACTION` with `500 INTERNAL_ERROR` "Internal server error", so the caller and the author were not told which action or which capability. A job body's denial was the same bare fault.

**What changes.** One gate, one answer. An action or job body's capability denial is the same refusal: `403 INSUFFICIENT_PRIVILEGES`, an existing standard catalog code, with a sentence such as `capability 'api.read' not granted to action 'note_count' (called ctx.api.object('note').find). Grant it by adding 'api.read' to the action's body.capabilities.` The remedy names the body's own owner (the hook's, the action's or the job's `body.capabilities`). The capability check is exactly as strict as before; nothing the body asked for runs. An action's refusal is logged once at `info`; a job reaches no HTTP caller, so its run records this sentence and its `error` log line stays.
