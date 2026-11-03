---
'@objectstack/spec': minor
---

feat(spec): declare the mobile sign-in hand-off surface (one-time-token hand-off and verify, and the registered app-scheme list)

Clause-②: yes
Metadata-protocol: added

Some identity providers refuse embedded WebViews, so a mobile app signs in through the system browser and needs the session handed back to its WebView. This declares the contract the auth plugin serves for that, before the plugin enables it:

- **`AuthEndpointPaths.oneTimeTokenHandoff`** (`GET /one-time-token/handoff`) with `OneTimeTokenHandoffQuerySchema`: a closed query of `redirect_uri` (an absolute URI), an RFC 7636 S256 `code_challenge` and an optional `code_challenge_method` (only `S256`). A signed-in session is redirected to `redirect_uri` with a single-use `token` that expires after one minute. An unregistered scheme, an unknown or repeated parameter, or a bad challenge is refused with `400 VALIDATION_ERROR` and no redirect.
- **`AuthEndpointPaths.oneTimeTokenVerify`** (`POST /one-time-token/verify`, better-auth's own route) with `OneTimeTokenVerifyRequestSchema` and `OneTimeTokenVerifyResponseSchema`. The body is `{ token }`, where the token is followed by a dot and the code verifier. A callback intercepted by another app cannot be redeemed without the verifier. The response is better-auth's unwrapped `{ session, user }` with the session cookie. better-auth's `GET /one-time-token/generate` refuses client requests, so it is not declared.
- **`AuthConfig.trustedAppSchemes`** (new authorable key, beside `trustedOrigins`): the native-app schemes the hand-off may redirect to. Each entry is a `TrustedAppSchemeSchema`: a lowercase reverse-domain scheme written bare: two or more non-empty labels joined by single dots, the first starting with a letter (RFC 8252 section 7.1), such as `com.example.app`. A malformed entry is refused, not dropped or rewritten. That includes a `://` suffix, an uppercase letter, a dotless name such as `myapp`, and every web scheme such as `https`. If the list is absent or empty, the hand-off is not offered.

No `/auth/config` feature flag is added, because nothing reads one yet.

Nothing to do for existing configurations. To offer the hand-off, list the app's scheme in `trustedAppSchemes`.
