---
"@objectstack/runtime": patch
---

fix(runtime): `callData` no longer has a `batch` arm that answers a silent, empty success (#5856)

`callData`'s `action === 'batch'` arm returned `{ object, results: [] }` — an
HTTP 200 whose body a consumer cannot tell apart from "the batch ran and matched
nothing" — while opening no transaction and writing nothing. It was the only arm
in that function answering an unimplemented action with **success**: every other
unhandled action throws `400 Unknown data action: …`, and `aggregate` throws
`503` when the engine cannot serve it. Retry, idempotency and audit logic all
read a 200 + empty result set as one successful empty operation.

Nothing could reach it, and that is the point: its safety lived **upstream**, in
a route table that happens not to spell `batch`, not in any guard of its own —
the ADR-0115 Evidence 5 / #4451 shape, where one route-table extension silently
turns a dormant branch into a live "successfully did nothing". Every entry point
was enumerated before removal (`/data` compares `parts[1]` against the literal
`'query'` and otherwise reads it as a record id; the MCP bridge, the actions
domain and `invokeBusinessAction` pass literals; the declarative endpoint
executor is bounded by `ApiEndpointSchema.objectParams.operation`, a closed enum
of find/get/create/update/delete; and `callData` is not part of this package's
export surface), so the arm is removed under ADR-0049 enforce-or-remove rather
than converted to a 501 nobody would ever receive.

**Behaviour on every live path is unchanged** — no reachable request produced
that response. What changed is the answer waiting for the first caller who ever
does spell `batch`: a loud `400 Unknown data action: batch`, identical to any
other unknown action, instead of a silent success. Batching itself is untouched
and keeps its single owner: `@objectstack/rest`'s `registerBatchEndpoints`
mounts both `POST /batch` (atomic, cross-object) and `POST /data/:object/batch`
(per-object, ADR-0119) — which is exactly why a host serving only the
dispatcher reports `capabilities.transactionalBatch: false` (#5672).
