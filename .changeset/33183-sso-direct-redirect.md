---
'@objectstack/plugin-auth': minor
'@objectstack/spec': minor
'@object-ui/auth': minor
'@object-ui/console': minor
'@object-ui/i18n': minor
---

feat(plugin-auth): with single sign-on configured, a signed-out visit can go straight to the identity provider and come back to the page it asked for

Clause-②: yes (widening) — `/auth/config` serves a new `features.directSignIn` flag (always, `false` unless the setting is on) and, while it is on, a `localSignIn` value (`hidden` | `off`); `PUBLIC_AUTH_FEATURES` gains `directSignIn`, so `requiresFeature` accepts the new value `'directSignIn'`; `GET /api/v1/auth/sign-in/direct` answers while the setting is on. With the setting off (every existing deployment) the door is not mounted and every other answer is unchanged.
Metadata-protocol: added

A deployment that signs people in through one identity provider can now skip the sign-in page. Turn it on with the auth plugin's `directSignIn` option, or with the environment:

- `OS_AUTH_DIRECT_SIGN_IN_ENABLED` — `true` or `false` (also `1`/`0`, `on`/`off`, `yes`/`no`); wins over the option.
- `OS_AUTH_DIRECT_SIGN_IN_PROVIDER` — the provider to use: an `oidcProviders` entry's `providerId` or an SSO provider's `providerId`. Unnamed, the one configured provider is used; with none or several, the sign-in page is shown as before.
- `OS_AUTH_DIRECT_SIGN_IN_LOCAL_PATH` — `hidden` (default: the password form stays reachable at `/login?local=1`) or `off` (the sign-in form offers no local way in, in any of its states: no email or phone form, no sign-up link and no break-glass link, also on an OAuth client's hand-off and when no provider can start). An unknown value refuses to boot. `off` is the page's choice only: the server's `/sign-in/email` still accepts a password.

While it is on, a signed-out visitor to the Console sign-in page is sent through `GET /api/v1/auth/sign-in/direct?callbackURL=…` to the identity provider and comes back to the same sign-in URL, where the usual post-sign-in steps run (organization pick, OAuth and mobile hand-offs, the safe `?redirect=`). The door keeps only a same-origin path as the return address; an absolute URL, `//host`, a backslash, a control character or any of these behind percent-encoding is dropped, and the sign-in returns to the Console root. It mints nothing: it starts the identity provider's own sign-in and passes its state cookie through.

The page never loops: an identity-provider error, a return without a session (a blocked cookie), a door that could not start, or an explicit sign-out in that tab (the maintainer's ruling, comment 6879236460 on #33183: only a fresh signed-out visit starts on its own) shows the page with a **Continue with single sign-on** button (and the reason, where there is one) instead of starting again. A start the identity provider's sign-in rate limit refused says so (`error=direct_sign_in_rate_limited`: wait a few seconds and try again) rather than pointing at the configuration. With the setting on and its door mounted by the same reading, `/auth/config` never advertises a door that is not there. An OAuth client's hand-off (`client_id` / `redirect_uri` on the URL) keeps today's page. `/auth/config` serves `directSignIn: true` only while a provider can be started, so the page does not navigate to a door that would turn it back. API keys, bearer tokens, `/api/*` and `/mcp` are never redirected.
