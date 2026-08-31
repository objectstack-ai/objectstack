---
'@objectstack/core': patch
---

Scope the legacy platform-admin deprecation pointer to walled tenancy postures

The request-side notice that tells an operator their unscoped `admin_full_access`
grant row is the OLD anchor — "it is removed in a later release", "re-anchor this
deployment by declaring its administrators in configuration" — was emitted without
regard to the deployment's tenancy posture, so it fired on `single` rigs too.

`single` is the DEFAULT posture, and on a `single` rig that row is not legacy at
all: the boot-time `bootstrapPlatformAdmin` mints it to promote the first human
user, and that promotion is ruled correct and unchanged. Such a deployment was
therefore being told, once per process, to migrate off an anchor that is not
scheduled to go away, toward a variable its own promotion is pinned never to read.

The pointer is now gated on `postureEnforcesWall(resolveTenancyPosture())`, the
same predicate and the same source the boot-side detector already reads, so the
migration window's loudness is scoped to the walled postures actually in it.
Walled rigs are unaffected and still receive the notice.

⛔ Standing is not touched: this is a log-line trigger, not access control. Every
deployment resolves exactly the `PLATFORM_ADMIN` it resolved before.
