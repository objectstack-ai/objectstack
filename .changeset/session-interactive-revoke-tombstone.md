---
"@objectstack/plugin-auth": patch
"@objectstack/platform-objects": patch
---

fix(plugin-auth,platform-objects): record the `admin` cause an interactive session revoke never could (#7732)

`sys_session.revoked_at` / `revoke_reason` are declared `readonly` and
documented "System-managed", and `revoked_at`'s description names all four
causes they capture: *idle / absolute-max / concurrent-cap / admin* (ADR-0069
D4). Three of them worked — `enforceSessionControls` and `enforceConcurrentCap`
expire the row in place and stamp both columns. The fourth could not: an
admin or user-initiated revoke reaches better-auth's `deleteSession` /
`deleteUserSessions`, which **delete the row**, and a deleted row carries no
`revoke_reason`. The audit trail was inert for the single cause an audit most
wants.

**What changes.** An interactive revoke now ends the session by stamping it
rather than deleting it — the same shape the automatic path already writes
(`expires_at` into the past plus both columns). Five endpoints are covered:
`POST /revoke-session`, `/revoke-sessions`, `/revoke-other-sessions`,
`/admin/revoke-user-session` and `/admin/revoke-user-sessions`. Self-service
revocations record `revoke_reason: 'user_revoked'` and the two admin routes
record `'admin'`, because the column is the only thing in the row that says who
ended the session and recording `admin` for a user signing out their own other
device would be a *wrong* audit record rather than a vague one.

The substitution happens at the better-auth → ObjectQL adapter, so better-auth's
whole session-delete hook lifecycle still runs — **OIDC back-channel logout
still fires on a revoke**. `sys_session`'s field declarations are unchanged.

**Revoked rows are also retained.** better-auth's one expiry-driven collector
(inside `GET /get-session`) would otherwise delete the new tombstone the moment
the revoked client next polled, leaving the trail exactly as inert as before —
which is why the automatic path's stamps were already best-effort. A revoked
row is now invisible to better-auth's own session reads, so that collector never
sees it. The revoked session therefore stops authenticating *harder* than before
(`findSession` answers nothing at all, rather than answering an expired row),
and its record survives. User-deletion routes still see and physically remove
these rows: erasing a user erases their sessions.

**Behaviour worth knowing about:** a revoked session no longer disappears from
the database. The `My Sessions` and `All` views on `sys_session` filter revoked
rows out, so the Sessions list looks exactly as it did; a new **Revoked** view
exposes `revoked_at` / `revoke_reason` for auditing. There is no retention
window or sweeper for `sys_session` — revoked rows are kept indefinitely, the
same way a session abandoned without signing out already was.

A normal sign-out is untouched: it still deletes the row and writes no
`revoke_reason`. Signing yourself out is not a revocation, and whether it earns
an audit record is a separate open question (#7675).
