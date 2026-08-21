---
"@objectstack/plugin-auth": patch
---

**Behaviour change (tightening):** registering an SSO identity provider through the direct `POST /api/v1/auth/sso/register` endpoint now requires a **platform admin**. An organization **owner or admin** who is not a platform admin can no longer register an identity provider on any surface (#10009).

Who loses access: an org owner/admin (a `sys_member` row graded owner/admin) with no org-less `admin_full_access` grant. They previously passed the ADR-0024 before-hook on the direct endpoint and now receive `403 SSO_REGISTER_FORBIDDEN`. Platform admins — an org-less `sys_user_permission_set` link to `admin_full_access`, per ADR-0068 D2 — are unaffected, as are anonymous callers, who still fall through to better-auth's `sessionMiddleware` (`401`).

This closes a posture divergence: the four `/admin/sso/*` bridges the `sys_sso_provider` metadata actions call have gated on the platform-admin judge since #9653, while better-auth's own endpoint kept the wider ADR-0024 admit set — so the same principal was refused at one door and admitted at the other for the same underlying registration, leaving the bridge tightening as labelling rather than a boundary. Per the 2026-08-20 maintainer ruling, ADR-0068 D4 governs: registering an identity provider is a platform-operator action. If org-scoped IdP self-serve is ever wanted, it is a deliberate future decision rather than a vendor default inherited by omission.

The direct endpoint also gains its first test pins; the now-callerless `isOrgOrPlatformAdmin` predicate was removed rather than left dead.
