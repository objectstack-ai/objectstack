---
"@objectstack/plugin-auth": patch
---

Ledger and document the ObjectStack-owned auth mounts that were in neither the route ledger nor the docs (#10534).

`auth-plugin.ts` mounts 17 routes directly on the raw Hono app ahead of the better-auth catch-all. A census found **nine** of them in neither half of `auth-route-ledger.ts`, and **six** with no literal wire path anywhere in the hand-written docs — the state that let a mount and its documentation gap ship separately with nothing objecting.

**Ledger:** eight mounts gain reviewed `source: 'objectstack'` rows — `/admin/import-users`, `/admin/oauth2/toggle-disabled`, `/admin/sso/register`, `/admin/sso/register-saml`, `/admin/sso/request-domain-verification`, `/admin/sso/verify-domain`, `/admin/unlock-user`, `/sys-oauth-application/register`. All are `disposition: 'server-only'`: each was measured to have zero `ObjectStackClient` callers and exactly one real caller that is a declarative metadata action target or a Console wizard. `POST /api/v1/auth/set-initial-password` is deliberately left unledgered and escalated rather than given a guessed disposition.

**Docs:** `GET /api/v1/auth/bootstrap-status`, `POST /api/v1/auth/set-initial-password`, `POST /api/v1/auth/admin/unban-user`, `POST /api/v1/auth/admin/sso/register`, `POST /api/v1/auth/admin/sso/request-domain-verification` and `POST /api/v1/auth/admin/sso/verify-domain` are now documented with their literal wire paths, including the opt-in `OS_SSO_DOMAIN_VERIFICATION` domain-verification flow and the asymmetric way its two halves report the switch being off.

No route's mounting, behaviour or accept/reject set changes.
