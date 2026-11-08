---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a delegated answer about a user the caller cannot read does not depend on that user's existence or memberships

Clause-②: no (narrowing) — the delegated-administration gate judges every target user through the caller's own read, so a user the caller cannot read is outside every delegated subtree: a delegated administrator no longer edits or removes a stored direct grant of such a user, and no longer explains such a user's access or reads its effective access. Nothing is widened: no export, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export of the package entry changes: an adminScope and a direct grant keep their shape and meaning, and a target user is judged through the caller's own read. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing in the delegated-administration gate (`@objectstack/plugin-security`), only for a delegated administrator asking about a user it cannot read.

- **Rule.** A delegated answer about a user the caller cannot read does not depend on that user's existence or memberships (ADR-0090 D12). Wherever the gate judges a target user, such a user is outside every delegated subtree, exactly as an id naming no user is: the holder a direct grant names (a new grant, or a stored grant pointed at another user), the holder a stored grant keeps (its removal, or an edit that leaves `user_id` as stored), and the user the explain doors ask about.
- **What a caller sees.** A delegated direct-grant write whose target user the caller cannot read answers `403 DELEGATION_SCOPE_VIOLATION`, with the sentence and details of every target outside the subtree. `security/explain` with a `userId`, and `security/users/:id/effective-access`, answer a delegate asking about a user it cannot read with their refusal of a user the caller may not describe (`403 PERMISSION_DENIED`), the answer an id naming no user gets.
- **Unchanged.** A target user the caller reads is judged as before, on its business units. A tenant-level administrator's writes, and an organization administrator's writes and explain coverage, are judged as before.
- **Who moves.** A delegate whose stored grant's holder it cannot read can no longer edit or remove that grant, and a delegate can no longer explain, or read the effective access of, a user it cannot read. Tenant-level and organization administrators keep both: either still removes such a grant, and explains such a user, as before.
