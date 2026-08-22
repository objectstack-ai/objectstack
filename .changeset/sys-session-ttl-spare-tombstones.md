---
"@objectstack/platform-objects": minor
---

Declare an ADR-0057 lifecycle policy on `sys_session` (#7826): the object is
now `class: 'transient'` with
`ttl: { field: 'expires_at', expireAfter: '1d', onlyWhen: { revoked_at: { $null: true } } }`.

**Ordinary expired sessions are now reaped** by the LifecycleService Reaper one
day after `expires_at` passes — the same window `sys_device_code` uses. Until
now nothing swept this table: better-auth's only expiry-driven collector fires
inside `GET /get-session`, so it can never reach a row whose cookie is never
presented again, and an abandoned session was effectively immortal.

**Revoked tombstones are deliberately spared.** The `onlyWhen` filter (#10165)
is load-bearing, not defensive: the #7732 revocation write backdates
`expires_at` to `now - 1000` and clears nothing, so an ADR-0069 D4 audit
tombstone looks *maximally* expired — a TTL on `expires_at` without the filter
would reap the audit trail first and hardest.

Deliberate, known consequence: because tombstones are spared entirely,
`sys_session` still grows without bound on the revoked arm. How long a
revoked-session tombstone should be retained is compliance / audit-trail
policy and is not settled here.
