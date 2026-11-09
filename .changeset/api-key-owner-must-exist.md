---
'@objectstack/core': patch
---

fix(core)!: an API key authenticates only as an owner who exists

Clause-②: yes (narrowing) — a request authenticated by an API key whose owner has no user record is answered as a key that does not exist (the generic `401 UNAUTHENTICATED`), at every door that accepts a key, and never falls through to a session sent beside it. The widening half: the exported `ApiKeyRefusalReason` union gains `'owner_absent'`.
Metadata-protocol: none
Skills-docs: updated here — `content/docs/permissions/authentication.mdx` states the rule; the dogfood pin `api-key-owner-exists.dogfood.test.ts` exercises it.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest changes: the owner row the key admission already reads decides it, and no key row is revoked or rewritten. -->

**BREAKING** accept-set narrowing at every key-admitting door (`@objectstack/core`): an API key authenticates only as an owner who exists.

- **The rule.** An API key is a credential of the user who minted it. A key whose owner has no user record is a credential of no one: it is refused where a key becomes its owner (the shared key-admission seam), with the answer a key that does not exist gets, on the REST data door (read and write), the MCP door and every other door that resolves a key. It never falls through to a session sent beside it.
- **A store with no `sys_user` table refuses every API key.** No owner exists in such a store, so no key authenticates there. This is deliberate, and it is the same answer as a store whose `sys_user` table holds no row for the key's owner.
- **What the operator sees.** Each refused request logs one server-side line, `[security] API key refused (owner_absent)`, naming the key's row id and the owner id, so the key to revoke is named. The caller is told nothing beyond the generic `401`.
- **Unchanged.** A key's own lifecycle still answers first: a revoked, expired or inactive key keeps its located `403`. An owner read that fails still answers `503`. A key whose owner exists is unaffected, and no read is added: the decision uses the owner read the ban check already makes.
- **Who moves.** An integration running on a key whose owner has no user record gets `401`.

**The remedy.** Mint a replacement key while signed in as an existing user, and revoke the orphan keys in **Setup → API Keys**.
