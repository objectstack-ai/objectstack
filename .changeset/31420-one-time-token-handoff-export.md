---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): `answerOneTimeTokenHandoff` — a host that forwards `/api/v1/auth/*` to a kernel's `AuthManager` answers the mobile sign-in hand-off

Clause-②: yes (widening)
Metadata-protocol: none

The package root now exports `answerOneTimeTokenHandoff(manager, request, serving)` with its input types `OneTimeTokenHandoffManager` and `OneTimeTokenHandoffServing`, and `HandoffAnswer` as a type beside them. It is the whole body of `GET /api/v1/auth/one-time-token/handoff`: AuthPlugin's own mount now calls it, and its answers do not change.

A host that serves no AuthPlugin routes and forwards the auth routes to an `AuthManager` it did not mount (a per-environment kernel with no HTTP server, AuthPlugin with `registerRoutes: false`) used to answer the hand-off `404`, because the route existed only on AuthPlugin's own server and a token minted outside the hand-off is unredeemable by design. Such a host now answers it for the manager it forwards to: `answerOneTimeTokenHandoff(manager, { url, headers, queries }, { authMountPath: '/api/v1/auth', server, serverEnv, onUnserved })`. A `302` answer carries `headers` and no body; every other status carries `body` as JSON with `headers`. The sign-in page a signed-out navigation is sent to is the one `server` answers, and `Location` stays root-relative, so the browser stays on the host it arrived on. The seams the hand-off is built from (`runOneTimeTokenHandoff`, `withHandoffChallenge`, `resolveHandoffSignInEntry`, the token-store hasher) stay unexported, so no host can mint outside the challenge scope.
