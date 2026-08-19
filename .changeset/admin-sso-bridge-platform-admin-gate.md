---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): the four `/admin/sso/*` bridges now run the inline ADR-0068 platform-admin gate before delegating into better-auth (#9653)

`POST /api/v1/auth/admin/sso/{register, register-saml, request-domain-verification, verify-domain}` used to hand the raw request straight to their bridge function, resting authorization entirely on the delegated better-auth endpoints. They now run the same shared platform-admin judge their `/admin/` siblings carry (`platform-admin-gate.ts`), before anything else:

- **anonymous caller → `401 UNAUTHENTICATED`** (previously the capability error: e.g. `404 SSO_REGISTER_FAILED` on a stock boot, which collapsed "not signed in" into "registration failed");
- **authenticated non-platform-admin → `403 PERMISSION_DENIED`** — this includes org owners/admins, who are not platform admins under ADR-0068; previously, with SSO enabled, the register bridges admitted them (and better-auth's own `/sso/register` admits any authenticated user for an org-less registration — measured on the installed `@better-auth/sso` 1.7.1);
- **platform admin → unchanged**: the request delegates into better-auth exactly as before, so all inner gates and hooks still run.

Registering an identity provider is a platform-operator action (ADR-0068 D4). The accept set only tightens; no successful flow for a platform admin changes.
