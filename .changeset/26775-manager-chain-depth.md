---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: the set-user-manager depth cap counts the whole chain a link creates, including the reports already below the edited user, so a chain linked bottom-up cannot pass `MAX_MANAGER_CHAIN_DEPTH` (#26775)

Clause-②: no (narrowing) — `POST /api/v1/auth/admin/set-user-manager`, the bulk user import's manager pass and the development boot's demo staff manager links refuse a link that would make a reporting chain longer than 20 links counted through the reports below the edited user, which they admitted before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the endpoint's documented depth cap is now enforced on the whole chain it creates. The refusal is the existing VALUE_OUT_OF_RANGE / 400 with details.reason max_depth_exceeded, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the manager-link write (`@objectstack/plugin-auth`), served by every caller of `applyUserManagerLink`.

- **Before.** The cap counted the link being written plus the managers above the proposed manager. The reports already hanging below the edited user were not counted, so a chain built from the bottom up was admitted one link at a time past 20 links.
- **Now.** The cap counts the managers above the proposed manager, plus the link, plus the longest chain of existing reports below the edited user. A link that would make the total pass 20 is refused with the same `VALUE_OUT_OF_RANGE` / 400 and `details.reason: 'max_depth_exceeded'` as before; the message now says the count runs through the reports below the user.
- **Unchanged.** A chain built from the top down is refused at the same link as before. A chain of exactly 20 links is admitted in any building order. The other refusals and their order are untouched.
- **Who sees it.** An admin, an import file or a `demoStaff` declaration that would build a reporting chain deeper than 20 links. Such a chain was resolved only in part by the hierarchy scopes that walk it, so a manager silently lost sight of records owned deep in it.

**The remedy.** Shorten the chain: attach the subtree under a manager closer to the top, or flatten the levels below the edited user.
