---
"@objectstack/client": minor
---

feat(client): a bearer-mode `ObjectStackClient` keeps the session the server rotates it onto (#16534)

Three better-auth routes ROTATE the caller's session on success — they mint a new session, install it in `Set-Cookie` (and, through `bearer()`, in the `set-auth-token` response header), and DELETE the row the caller was presenting:

| route | where the new credential is |
| --- | --- |
| `auth.twoFactor.verifyTotp()` on the enrolment lane | body — `token`, and it is the LIVE one (plugin-auth's `two-factor-rotated-token-echo` repairs the vendor's stale echo) |
| `auth.changePassword({ revokeOtherSessions: true })` | body — `token` |
| `auth.twoFactor.disable()` | **response header only** — the body is `{ status: true }` |

A browser is carried across all three by its own cookie. A bearer client — this SDK's own mode — kept presenting the DELETED session's token, so its very next call answered `401 UNAUTHORIZED`. Measured against a real `AuthManager` (better-auth 1.7.2) over a real driver, driven through the real `ObjectStackClient`, `login → enable → verifyTotp → disable → deleteUser` could not run to the end without the caller re-seating `client.token` by hand between the steps.

The three methods now adopt the rotated credential themselves, the way `login()` already adopts the token it is handed. The `token` members stay on the wire and stay declared, so a caller that keeps its own credential store is unaffected; what changes is that it no longer has to.

**No public surface moves.** No new export, no new option or flag, no new key on any declared request or response type — the SDK stores a token the server already sends and this package already declares. Graded `minor` rather than `patch` because the published runtime behaviour of three methods moves for existing callers.

## What does NOT change, deliberately

The adoption is on those three routes only, never in the shared `fetch` wrapper. `set-auth-token` rides **every** response that stages a session cookie — `POST /update-user` stages one to carry the updated user without rotating anything — and it carries the SIGNED `<token>.<sig>` spelling while every JSON `token` echo carries the UNSIGNED one. A wrapper-level read would therefore rewrite the stored credential into a different spelling of the SAME session on ordinary traffic. `auth.me()`, `auth.sessions.list()`, `auth.updateUser()` and `auth.twoFactor.verifyBackupCode()` (which does not rotate — the vendor echoes the session it resolved at entry) all leave the stored credential byte-identical, and that is pinned.

A cookie-only deployment sends no `set-auth-token`; there is then nothing to adopt and `twoFactor.disable()` leaves the stored credential exactly as it was. `changePassword` without `revokeOtherSessions` answers `token: null` and likewise stores nothing.

The three TSDoc warnings that told bearer callers "this SDK does not store it" are updated in the same change.
