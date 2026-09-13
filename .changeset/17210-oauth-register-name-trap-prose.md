---
'@objectstack/client': patch
---

`oauth.applications.register`'s docblock says where a plain `name` IS honoured, and that it is not this route

A caller who wants to name an OAuth client reaches for `name`. On the route this
method posts — the provider's `/oauth2/create-client` — that member is not in
the body schema and is stripped: driven on a real socket, the call answered
**201** and the value was absent from the response, from `applications.get`,
from `applications.list`, and `null` in the `sys_oauth_application` row's `name`
column. Nothing in the answer says so.

The spelling is not wrong everywhere, which is what made it worth writing down:
`POST /api/v1/auth/sys-oauth-application/register` — the session-required
ObjectStack mount behind the Console's *Setup → OAuth Applications* form —
answered **200** to the same body, mapped `name` onto `client_name`, and set
that column. That mount is `disposition: 'server-only'` in the auth route ledger
and objectstack#17210 ruled it stays that way, so no SDK method builds its URL.

The docblock now states both halves where the caller reads them: post
`client_name` to name a client from here, and `redirect_uris` must arrive
pre-split — the newline-separated-textarea split is the Console wrapper's, not
this route's.

Docblock only. No method is added, no request or response type changes, and the
ledger row is untouched — but the text ships inside `dist/*.d.ts` as editor
hover, so it is a `patch` rather than a no-publish change.
