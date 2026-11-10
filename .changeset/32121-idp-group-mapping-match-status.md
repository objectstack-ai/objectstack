---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat(plugin-auth): an IdP group mapping says whether it matches a current group of its source

Clause-②: yes (widening) — three new read-only columns on `sys_idp_group_mapping` (`match_status`, `matched_group_id`, `match_changed_at`), shown in its `all` list view. No package export changes. Nothing existing is removed, retyped or refused; the object's data API stays list-only.
Metadata-protocol: none

A group mapping now says whether the group it names is one its SCIM connection pushes right now. `match_status` reads `matched` (with `matched_group_id`, the `sys_scim_group` it matches), `unmatched` (the identity provider renamed or deleted the group, or never pushed it) or `not_applicable` (an SSO provider, which sends groups only as a sign-in claim and stores no group list). `match_changed_at` records when the answer last changed, so a console can show "matches no current group since …".

plugin-auth keeps the columns current on every write to either side: a SCIM group create, rename (`PATCH` or `PUT`) or delete, and a mapping save. A membership change writes nothing to the mapping. The answers are re-judged once per boot too, so mappings saved before this release read right after the upgrade. A failure to re-judge never fails the SCIM request that triggered it; it is logged at `error` and heals on the next write or boot.

Who gets which grant does not change: the projection still matches on every membership change, and a mapping that matches nothing still grants nothing.
