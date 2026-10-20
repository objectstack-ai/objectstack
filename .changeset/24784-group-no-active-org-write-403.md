---
'@objectstack/plugin-security': patch
---

fix(plugin-security): under the `group` posture, a tenant-scoped insert from a session with no active organization is refused 403 naming the missing organization, as `isolated` already answered, instead of a 500

Clause-②: no (no accept set moves: the insert was refused before and is refused now, with the ADR-0123 D2 answer in place of an internal error)

- **Before.** On `group` (any union-scope posture), a member of an organization whose session had no active organization got `500 ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` for a create on a tenant-scoped object, logged as an unhandled REST error.
- **After.** That create gets `403 PERMISSION_DENIED` with the message `isolated` gives the same session, which names the missing active organization and tells the user to join or select one.
- **Unchanged.** Nothing was written before and nothing is written now. The refusal judges the row as it is about to be stored, the same row the engine's own organization check reads, so it covers exactly the inserts that answered 500 and no insert that was admitted. Reads still span the member's organizations. Updates and deletes of rows the membership wall admits, inserts from a session with an active organization, system contexts, a platform operator on a posture-permitting object, the delegator's leg, and every `isolated` and `single` answer are as before.
