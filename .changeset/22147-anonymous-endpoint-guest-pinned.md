---
'@objectstack/runtime': patch
---

Declarative endpoints: an anonymous request at an `authRequired: false` endpoint is documented and pinned as executing as the guest principal

Clause-②: no

- **What anonymous endpoints do: unchanged, and now measured.** An unauthenticated request admitted by an `authRequired: false` endpoint executes as the guest principal: `principalKind: 'guest'`, `positions: ['guest']`, `isSystem: false`. The runtime's identity resolution builds this envelope for every sessionless request. It is neither principal-less nor the system principal.
  - An `object_operation` endpoint hands that guest to its data calls. No permission set is bound to the guest, so the call is refused with `403 PERMISSION_DENIED`, the same refusal a signed-in caller without a grant gets. Nothing of the record comes back.
  - A `flow` endpoint hands the flow executor the guest's `guest` position, with no user and no elevation. The flow's own `runAs` declaration still governs how its data steps run, and a `runAs: 'user'` flow still refuses its data steps when the run has no user.
  - An `authRequired: true` endpoint still answers an anonymous request with `401`.
- **What changed: the type documentation, and the pins.**
  - The `executionContext` documentation on `BuildEndpointExecutionContextInput` and `AppEndpointExecutionInput` said an anonymous request arrives as `undefined`, which reads as principal-less execution. It now says the request arrives as the guest principal.
  - Tests over a socket and on a real boot now hold this guest posture, so a change to it can no longer pass silently.
