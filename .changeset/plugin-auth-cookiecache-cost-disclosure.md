---
"@objectstack/plugin-auth": patch
---

docs(plugin-auth): state what the `session.cookieCache` door costs, measured against better-auth 1.7.1 (#12547)

No behaviour change, no API change, and ⛔ **no boot refusal** — the #4785
posture stands on both doors: deliberate opt-in with the cost disclosed
(maintainer ruling 2026-08-27). `cacheSecondaryStorage()` stays exported and
`AuthManagerOptions` accepts exactly what it accepted before.

This is shipped as a changeset rather than left in source comments because the
CHANGELOG is where the sibling door's posture already lives — *"remains
exported for anyone who wants better-auth's cached session store deliberately.
It now says plainly what it costs."* An operator weighing `cookieCache` reads
the changelog, not our TSDoc, and one door's cost being on the public record
while its sibling's is not is the asymmetry this closes.

**What was measured**, against the installed better-auth `1.7.1` (read out of
`node_modules`, never off the `^1.7.1` range):

- **The failure direction is the sibling's.** With `cookieCache` enabled,
  `/get-session` answers from a signed payload in the client's own
  `session_data` cookie and returns before any adapter read. ObjectStack
  revokes by writing the `sys_session` row (ADR-0069 D4) and hides tombstoned
  rows from better-auth's reads — all read-path enforcement, so while the
  cookie answers, a revoked session keeps authenticating and nobody gets an
  error.
- ⭐ **The reach is materially smaller, and the disclosure says so rather than
  inheriting the sibling's wording.** The session of record does not move —
  `createSession` still writes the row, so admin session lists, the
  concurrent-cap count and D4's audit trail stay correct. The staleness window
  is bounded and per-client (`cookieCache.maxAge`, default 300s) and cannot be
  extended without a database read, because better-auth force-disables its
  stateless `refreshCache` whenever a `database` is configured — which
  ObjectStack always does. Sensitive operations already bypass it via
  better-auth's own authoritative re-read. `secondaryStorage` has none of these
  three bounds.
- **It is not reachable from ObjectStack config today, by construction rather
  than by refusal.** The spec's `AuthConfigSchema.session` declares
  `expiresIn` / `updateAge` only and `createAuthInstance` reads only those two,
  so a `cookieCache` key is dropped rather than honoured. The one way in is the
  `authInstance` escape hatch, where the host has replaced the whole config.

The disclosure lands at `auth-manager.ts`'s `session:` block — the place a
future author would plumb the key — with a pointer from `secondary-storage.ts`
so the two doors are described together. An **observation** pin in
`session-of-record.test.ts` records the drop end-of-chain: a revoked session
still de-authenticates on the very next request. ⛔ It pins no refusal; it is
the tripwire a paragraph alone could not give, so the day someone plumbs
`cookieCache` through, a red test points at the cost note instead of D4
quietly acquiring a revocation window nobody chose.
