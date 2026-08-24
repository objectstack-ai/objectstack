---
'@objectstack/plugin-security': patch
'@objectstack/plugin-auth': patch
---

Walled platform-admin elevation now requires the owner-email match to be
VERIFIED, and the bootstrap re-runs on the verifying update (#11343)

Under walled postures (`group`/`isolated`), `bootstrapPlatformAdmin` matched
the env-declared `OS_PLATFORM_OWNER_EMAIL` against the raw email string on
`sys_user` — with no `email_verified` condition, while email verification is
off by default. #11211 narrowed elevation from "whoever registers first" to
"the declared owner's address" (a real and large narrowing); this closes the
remainder that card #11343 records: in the window before the owner registers,
an account created with the owner's address would still be elevated.

Two halves, deliberately in one change:

1. **The elevation match requires `email_verified`** (fail-closed allow-list
   over driver representations; an absent field on an imported/legacy row
   reads as unverified). An unverified holder of the owner's address is
   refused like any stranger — new reason `walled_owner_not_verified`, logged
   loudly with the unblock in the line. Never falls back, same direction as
   the undeclared-owner refusal.
2. **The bootstrap-replay middleware now also fires on `sys_user` updates
   touching `email_verified` / `email`** (trigger set extracted as
   `shouldReplayBootstrapFor`, consumed by the middleware and its pins alike).
   Verification is an UPDATE — with the old insert-only replay, requiring
   verification would have refused the genuine owner at sign-up and then
   never looked again, leaving the platform without any administrator.

`single` posture is untouched both ways: first-user promotion (ruled
reasonable in #11184) does not gain a verification requirement, and the
owner-email variable is still never consulted there. Both directions are
pinned: the unverified holder is refused AND the verified owner is elevated —
including across the refuse-then-verify-then-re-run sequence.

The seeded dev admin (`maybeSeedDevAdmin`, dev-only) is now provisioned with
`email_verified` stamped: it is created by the deployment's own boot command
with operator-known credentials — the same trust shape as a trusted-SSO
insert, not an unknown self-registrant — so walled dev/harness boots keep a
promotable declared owner. The generic sign-up path is unchanged.
