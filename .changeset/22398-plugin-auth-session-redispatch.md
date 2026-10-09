---
'@objectstack/plugin-auth': minor
---

fix(auth): the plugin-auth doors that re-dispatch to better-auth or call its endpoints in-process no longer renew a browser session behind its cookie (#22398)

**What was wrong.** A better-auth session read renews a session older than `session.updateAge`: it moves `sys_session.expires_at` to `now + expiresIn` and stages the renewed session cookie on that read's own response. Eight doors read the session in-process by a route other than `auth.api.getSession`, so the rule the `getSession` readers follow did not reach them, and each kept only the JSON, or the status and body, of the response the cookie was staged on. Measured on better-auth 1.7.3 with a session aged to `now + expiresIn − updateAge − 60 s`, each moved `expires_at` by +86460 s on a cookie request and set no session cookie, before its own answer (a refusal included):

- through a `/get-session` re-dispatch and the bridge's forward to a better-auth route: `POST /api/v1/auth/admin/sso/register`, `POST /api/v1/auth/admin/sso/register-saml`, `POST /api/v1/auth/admin/sso/request-domain-verification`, `POST /api/v1/auth/admin/sso/verify-domain` and `POST /api/v1/auth/send-verification-email`;
- through an in-process vendor endpoint call carrying the request's headers: `POST /api/v1/auth/organization/add-member` (`addMember`), `POST /api/v1/auth/set-initial-password` (`setPassword`) and `POST /api/v1/auth/sys-oauth-application/register` (`createOAuthClient`).

**The rule now** is the one every in-process `getSession` reader follows, decided by what the request carries:

- **A session cookie** (a browser): the re-dispatched URL carries `disableRefresh=true`, and a vendor endpoint call takes `inProcessSessionReadInput(headers)` from `@objectstack/types`, whose `query` better-auth's session middleware passes into its read. The session renews only through `GET /api/v1/auth/get-session`, which re-issues the cookie, so cookie and session expire together. Measured after the change: each door leaves `expires_at` unchanged on a cookie request and sets no cookie.
- **No session cookie** (a bearer-only client): unchanged. Each door still renews the session to `now + expiresIn` and sets no cookie on a response to a request that sent none.

**Upgrading.** Nothing to change. The shared helpers the cloud auth proxy mounts (`runRegisterSsoProviderFromForm`, `runRegisterSamlProviderFromForm`, `runRequestDomainVerification`, `runVerifyDomain`, `runResendVerificationEmail`, `runSetInitialPassword`) carry the same rule, so both mount points stay in step. `SetPasswordCapableApi.setPassword` now also accepts an optional `query: { disableRefresh: true }`; better-auth's own `auth.api.setPassword` honours it (measured on 1.7.3).
