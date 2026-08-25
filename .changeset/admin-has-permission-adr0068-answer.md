---
'@objectstack/plugin-auth': patch
---

`POST /api/v1/auth/admin/has-permission` now answers an ObjectStack platform admin from the ADR-0068 platform-authz predicate. The vendor evaluated this permission query on the legacy `user.role === 'admin'` scalar that ADR-0068 D2 stopped synthesizing, so a genuine platform admin was answered `success: false` — indistinguishable from a plain member. The route is now shaded by an ObjectStack raw mount: a platform admin's query is evaluated against the vendor's own admin access-control statements with only the identity signal replaced (an ungranted or unknown permission still answers `false`), while anonymous callers, plain members, and every request body the vendor refuses to evaluate are delegated to the vendor unchanged, byte for byte.
