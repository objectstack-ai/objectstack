---
'@objectstack/core': patch
'@objectstack/trigger-api': patch
'@objectstack/runtime': patch
---

feat(automation): the inbound hook takes its flow's namespace, or `_env` (ADR-0150 D5)

Clause-②: yes (widening)
Metadata-protocol: none

`POST /api/v1/automation/hooks/:ns/:flowName/:hookId` is the inbound hook with the flow named by the namespace of the package that ships it, or by `_env` for the environment's own flow. It is the same door as `POST /api/v1/automation/hooks/:flowName/:hookId`: session-less, `POST` only, and the hook's HMAC signature is its only credential. Both faces serve it: the trigger's raw-app mount (`HOOKS_ADDRESSED_PATH`) on a self-hosted kernel, and the `/automation` domain on a kernel with no raw app.

- The address is served only when its qualifier names the package that ships the flow (the engine's `packagedFlowOwner`, matched against the registry's namespace table), or `_env` names a flow no package ships. This is judged before the signature is read, by one predicate in core (`admitInboundHookAddress`) that both faces ask.
- Any other address, whether the namespace is uninstalled, belongs to another package, or is `_env` for a packaged flow, gets the door's one refusal: `401 INVALID_SIGNATURE`, the same status, headers and bytes as a bad signature on the same flow and hook. It is never `404` or `409`, and it is answered only once the post's body has been read in full, as every post's body is read before the door answers, so neither the answer nor its timing tells one installed namespace from another. The cause is written to the server log only (`unadmitted-address`).
- The ADR-0069 allow-list gains a second parameterised row for the five-segment path, read through the one `matchInboundHookRoute`, which now returns the raw `qualifier`. That reading serves the anonymous floor, the authentication gate, the membership gate's skip and the domain's hand-off.
- The row never admits `runs` as the qualifier (`INBOUND_HOOK_QUALIFIER_EXCLUSIONS`). `POST /automation/hooks/runs/:runId/resume|cancel|restore-suspension` are the run doors of a flow named `hooks`, with the same verb and arity, and they keep their own gates. The raw-app mount hands such a request on to the route that serves it.
- Core now renders the refusal and its JSON response (`inboundHookRefusal`, `inboundHookJsonResponse`, `inboundHookRefusalResponse`). The trigger answers through them, so the hosted face's refusal is the member's bytes by construction.

Declared limit: a package whose namespace is `runs` has no qualified inbound hook (first-party count: 0). Its hooks stay reachable at the bare path.

Answer changes, all on paths no route served (`POST /api/v1/automation/hooks/:x/:y/:z` with `:x` not `runs`):

- Mounted host: the transport's `404 ENDPOINT_NOT_FOUND` becomes the hook door's answer: `401 INVALID_SIGNATURE`, or the member's own answer (`202` for a correctly signed post) on an admitted address.
- Catch-all host: an anonymous caller's `401 UNAUTHENTICATED`, and a signed-in caller's no-route answer, become that same answer, because a session is not this door's credential. Every other method on the path answers as before.
