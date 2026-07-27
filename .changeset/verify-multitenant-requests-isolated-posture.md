---
'@objectstack/verify': patch
---

`bootStack({ multiTenant: true })` now REQUESTS the `isolated` tenancy posture
for the boot (ADR-0105 D1), restoring the request on `stop()` and respecting an
explicit caller-provided `OS_TENANCY_POSTURE`.

Since #3559 a walled posture is an explicit operator request resolved from env
when AuthPlugin registers the `tenancy` service — mounting the enterprise
organizations plugin only ENTITLES it. The harness's multi-tenant opt-in
predates that split and only mounted the plugin, so multi-org fixtures silently
booted `single`: no Layer 0 wall, D3 default-org write stamping, and every
cross-tenant proof asserting against the wrong posture (first surfaced by
cloud's security-enterprise multi-org integration test, which runs the licensed
path open-core CI cannot).

The verify package also gains a `test` script so its suite actually runs under
`turbo run test`, including the new regression pin for this contract.
