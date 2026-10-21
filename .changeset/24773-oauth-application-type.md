---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the Console's OAuth Application Type reaches the provider as `application_type`, so a Native client can register a loopback redirect URI (#24773)

Clause-②: no — the declared type now takes effect under the OAuth provider's own redirect-URI rule, an authentication behaviour the maintainer ruled on; nothing published widens.

`POST /api/v1/auth/sys-oauth-application/register` (the Setup → OAuth Applications form) forwarded the form's Application Type as `type`. The provider's `/oauth2/create-client` body declares `application_type` (`web` | `native`) and no `type`, so the value was dropped and every client was judged and stored as `web`. A `native` client therefore could not register a loopback redirect URI such as `http://localhost:4001/callback`, and its `sys_oauth_application.type` read `web`.

- **Now.** `web` and `native` are forwarded as `application_type`, and the provider's own rule decides. A `native` client may use http only on exactly `localhost`, `127.0.0.1` or `[::1]` (any port), and is stored as `native`. A `web` client still needs an https URI on a non-loopback host.
- **Unchanged, with a warning.** Any other type, including the form's `user-agent-based` and `public`, has no `application_type` in the provider. It keeps today's outcome: registered and judged as `web`, with a client secret. The server now logs one warning per such registration, naming the value. To use a loopback redirect URI, register the client as `native`.
- **Unchanged.** No type at all is `web`. Refusals keep the codes and statuses they had: `400 OAUTH_REGISTER_FAILED`, with `error.details.upstreamError` `invalid_redirect_uri` when the redirect-URI rule refuses.
