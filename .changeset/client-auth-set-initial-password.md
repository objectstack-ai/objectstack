---
"@objectstack/client": minor
"@objectstack/plugin-auth": patch
---

**SDK:** `auth.setInitialPassword` binds the already-mounted `POST /api/v1/auth/set-initial-password` route, which had no client method.

`AuthPlugin` has mounted this route on the raw Hono app for as long as the SSO-onboarding flow has existed, but `packages/client/src` built the URL nowhere — measured zero for both `setInitialPassword` and `set-initial-password`, against four sibling auth members returning non-zero on the same corpus, so the absence was an absence and not a broken search. Its only caller was `@object-ui/auth`'s `createAuthClient`, whose three other auth URLs (`/config`, `/get-session`, `/list-accounts`) are all expressed on `ObjectStackClient`, and whose sibling branch in the very same Console password card — `changePassword` — has been ledgered `sdk` throughout.

The method is shaped exactly like its namespace siblings (`this.getRoute('auth')` + `this.fetch`, `POST` with a JSON body, returning the parsed envelope), because the difference between it and `changePassword` is a **server-side** one and belongs there: better-auth registers `setPassword` with no HTTP path of its own (server-only `auth.api.setPassword`), so ObjectStack wraps it in an authenticated mount that requires a session and refuses with 409 `PASSWORD_ALREADY_SET` when a credential already exists. Callers that already have a password use `changePassword`, which verifies the current one.

**Nothing about the route's behaviour moves.** Its accept/reject logic, its admit set and its server-side guards are untouched — this is a client binding to an existing mount, not a widening of what the mount allows.

**Its `AUTH_ROUTE_LEDGER` row lands with it**, because the two halves are one statement and neither is true alone. `plugin-auth` gains `{ route: 'POST /api/v1/auth/set-initial-password', family: 'objectstack-mount', source: 'objectstack', disposition: 'sdk', client: 'auth.setInitialPassword' }` — the ninth mount of the #10534 census, whose disposition was escalated rather than guessed and which the maintainer ruled `sdk` (option C, 2026-08-22) and then ruled should land in one PR (2026-08-23). Without the row, the method's URL matched only the dispatcher's `* /auth/**` prefix family, and `client-url-conformance.test.ts` bounds wildcard-only matches at zero on purpose; with it, the same URL resolves to an enumerated route. The row also brings the `check:auth-mount-ledger` pending-disposition entry down — the exemption that carried this route while the question was open is deleted, which is that ratchet working rather than being relaxed.
