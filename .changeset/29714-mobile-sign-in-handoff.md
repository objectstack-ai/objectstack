---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): the mobile sign-in hand-off — a sign-in completed in the system browser is handed to a registered app scheme as a single-use token, over better-auth's own `one-time-token` plugin

Clause-②: yes (widening)
Metadata-protocol: none

Some identity providers (Google among them) refuse to sign a user in inside an embedded WebView, so a mobile shell signs in in the platform's system auth session, where the session lands in the system browser rather than in the WebView the Console runs in. A deployment that lists its app's custom URL scheme in `trustedAppSchemes` now gets a way to carry that session across, once:

- **`GET /api/v1/auth/one-time-token/handoff`** (session required). Query: `redirect_uri` (an app callback), `code_challenge` (RFC 7636 S256: `BASE64URL(SHA-256(code_verifier))`, 43 characters) and optionally `code_challenge_method=S256`; no other parameter is accepted. It answers `302` to `redirect_uri` with a `token` query parameter added, uncacheable. A `redirect_uri` whose scheme is not registered answers `400 VALIDATION_ERROR` with no redirect, so the route is never an open redirect; a missing or malformed challenge also answers `400`, and a signed-out caller `401 UNAUTHENTICATED`.
- **The hand-off carries only a fresh sign-in.** A session signed in more than five minutes ago answers `401 UNAUTHENTICATED` (sign in again), so an app cannot silently carry away a session the browser has held for days; and a navigation the browser reports as `Sec-Fetch-Site: cross-site` answers `400 VALIDATION_ERROR` (the header is checked only when the browser sends it).
- **`POST /api/v1/auth/one-time-token/verify`** (better-auth's route, no session needed). Body: `{ "token": "TOKEN.code_verifier" }`. It answers better-auth's `{ session, user }` with the session cookie, once, within one minute.
- **An intercepted callback cannot be redeemed.** Another app on the device can register the same scheme and receive the callback, so the token is stored under a hash of the token and the challenge, and redemption recomputes it from the verifier the shell kept. A token presented without that verifier answers better-auth's `400 Invalid token` and consumes nothing, so the shell that started the hand-off still redeems it.
- **`GET /api/v1/auth/one-time-token/generate`** is published by the plugin and refuses every client request (`400` with a session, `401` without); the hand-off is the only place a token is minted.
- **`trustedAppSchemes`** (the spec's `AuthConfig.trustedAppSchemes`) entries must be lowercase reverse-domain private-use schemes with no `:` suffix (RFC 8252 §7.1, e.g. `com.example.app`, no empty or trailing label); `http`, `https`, `javascript`, `data`, `file`, `blob`, `about`, `vbscript`, `ws` and `wss` are refused. A bad entry fails the auth manager's construction (and `applyConfigPatch`), naming the entry. With no scheme registered, the plugin is not mounted and the hand-off refuses every target.
