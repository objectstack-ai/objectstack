---
"@objectstack/client": minor
---

**SDK:** `auth.setInitialPassword` binds the already-mounted `POST /api/v1/auth/set-initial-password` route, which had no client method.

`AuthPlugin` has mounted this route on the raw Hono app for as long as the SSO-onboarding flow has existed, but `packages/client/src` built the URL nowhere — measured zero for both `setInitialPassword` and `set-initial-password`, against four sibling auth members returning non-zero on the same corpus, so the absence was an absence and not a broken search. Its only caller was `@object-ui/auth`'s `createAuthClient`, whose three other auth URLs (`/config`, `/get-session`, `/list-accounts`) are all expressed on `ObjectStackClient`, and whose sibling branch in the very same Console password card — `changePassword` — has been ledgered `sdk` throughout.

The method is shaped exactly like its namespace siblings (`this.getRoute('auth')` + `this.fetch`, `POST` with a JSON body, returning the parsed envelope), because the difference between it and `changePassword` is a **server-side** one and belongs there: better-auth registers `setPassword` with no HTTP path of its own (server-only `auth.api.setPassword`), so ObjectStack wraps it in an authenticated mount that requires a session and refuses with 409 `PASSWORD_ALREADY_SET` when a credential already exists. Callers that already have a password use `changePassword`, which verifies the current one.

**Nothing about the route's behaviour moves.** Its accept/reject logic, its admit set and its server-side guards are untouched — this is a client binding to an existing mount, not a widening of what the mount allows.

**Its `AUTH_ROUTE_LEDGER` row is deliberately not in this change**, and one consequence is visible in CI: with no exact row, `client-url-conformance.test.ts`'s final assertion sees this URL matched only by the dispatcher's `* /auth/**` wildcard family and fails, because that bound is ratcheted to zero on purpose. The row and this method have to arrive together — see the PR body.
