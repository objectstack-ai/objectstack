---
'@objectstack/core': patch
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
---

fix(core)!: a banned user's credentials are refused while the ban holds, at every door that accepts an API key

Clause-②: yes (narrowing) — while a user's ban holds, a request authenticated by an API key that user owns is answered as a key that does not exist (the generic `401 UNAUTHENTICATED`), at every door that accepts a key: the REST data door, the MCP door, and every other door that resolves a key through the shared key-admission seam. The widening half: `@objectstack/core` exports the one ban predicate, `isUserBanInForce` (with `USER_BAN_FIELDS` and the `UserBanFields` type), which the key-admission seam and plugin-auth's session-shaped refusals now share.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest changes: the ban columns are read where a key becomes its owner, and no key row is revoked or rewritten. -->

**BREAKING** accept-set narrowing at every key-admitting door (`@objectstack/core`): a banned user's API keys are refused while the ban holds.

- **The rule.** A ban holds every credential of the user. Banning a user already ends their sessions and refuses their sign-in; their API keys now answer as a key that does not exist for as long as the ban holds. A ban with an expiry stops binding once the expiry has passed, exactly as sign-in does — no sign-in is needed to lapse it.
- **Not a revocation.** No key row is revoked or rewritten. Lifting the ban (or letting it expire) admits the same keys again, with nothing reissued, each still judged by its own lifecycle: a key left unused past the inactivity window during the ban answers as inactive (`API_KEY_INACTIVE`), and its remedy is a new key.
- **One anonymous entry.** A key refused for its owner (a ban) or for the tenancy posture (no organization under `isolated`) resolves to the same entry as a key that does not exist, on every composition: the guest's grants on a face that serves the guest, nothing elsewhere. It never falls through to a session.
- **Who moves.** An integration running on a key whose owner is banned gets `401` until the ban is lifted or expires.

**The remedy.** Lift the ban, or mint a replacement key under a user who is not banned.
