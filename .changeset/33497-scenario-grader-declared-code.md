---
'@objectstack/scenarios': patch
---

fix(scenarios): the run grader reads a hook's declared refusal off the door's `declaredCode`

Clause-②: no
Metadata-protocol: none

The MCP door serves a hook's own refusal code demoted off `code`: a hook that refuses with `ASSET_NOT_IN_STOCK` at 409 reaches the agent as `{ error: { code: 'RESOURCE_CONFLICT', status: 409, declaredCode: 'ASSET_NOT_IN_STOCK' } }`. The runner kept only `code` and `status`, so the grader saw a platform conflict and failed a card whose app refused exactly as it should (`check_out_asset_in_repair`, a declared `VALIDATION_FAILED`).

A refused `ObservedAnswer` now carries the envelope's `declaredCode` when the door served one, from a write call, the last read on the object and the runner's probe alike, in the nested and the flat envelope. `refusalMeets` reads it two ways: a declared code equal to `declaredCode` meets exactly, and a declared `VALIDATION_FAILED` is met by a `declaredCode` at any 4xx. A catalogue code with no `declaredCode` still never meets a different declared code, and a `declaredCode` at 5xx or with no status does not meet. The grade's detail names what met ("refused RESOURCE_CONFLICT (409), the hook's declared refusal ASSET_NOT_IN_STOCK").
