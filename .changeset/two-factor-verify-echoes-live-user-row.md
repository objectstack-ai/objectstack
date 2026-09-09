---
"@objectstack/plugin-auth": patch
"@objectstack/client": patch
---

`POST /two-factor/verify-totp` and `/two-factor/verify-otp` now echo the user row as it stands when the response is written, instead of the pre-rotation snapshot the vendor closes over.

On the enrolment lane — a signed-in caller confirming a new factor — better-auth writes `twoFactorEnabled: true`, rotates the session, and only then calls the `valid(ctx)` closure it built at entry. That closure still holds the pre-rotation session, so a successful verification answered `user.twoFactorEnabled: false` to the very caller who had just switched 2FA on. An account portal reading that body renders the factor as still OFF right after enrolment, and a bearer client that caches the echoed user carries the wrong flag until its next `get-session`.

`two-factor-rotated-token-echo` already repaired the body's other stale member, `token`, on exactly these routes and on exactly this predicate — the response staged a session cookie whose token differs from the one echoed. The `user` member is stale for the same reason, so it is repaired under the same predicate rather than a new one.

- **Two narrowings, both load-bearing.** Only the members the vendor already echoed are written, so the published payload shape (`AuthWireUser`) cannot widen — better-auth's own output filter is a deny-list, and forwarding a raw row would put every column it happens to carry on the wire. And the row is re-read through `internalAdapter` by the id the response itself published, so the repair travels the same output transform that produced the echo (a driver that stores booleans as `1`/`0` cannot change a member's wire type) and can never substitute a different principal into a response.
- **`/two-factor/verify-backup-code` is untouched.** It does not rotate and already echoed the live row; it is in neither path list, its row is not read, and it is pinned as a negative control on both the in-memory engine and a real `SqlDriver` — an unconditional re-read would have "fixed" the broken lane and quietly rewritten one that was already right.
- **The failure posture is inherited.** A row read that throws or answers nothing degrades to the vendor's own echo, never to a failed verification and never to a lost `token` repair, which is written first for that reason.

`@objectstack/client` drops the `AuthTwoFactorVerificationResult.user` warning that told callers to re-read the session for the live flag; the wire shape it declares is unchanged.
