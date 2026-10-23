---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/plugin-security': minor
'@objectstack/plugin-sharing': minor
'@objectstack/plugin-auth': minor
---

feat: a holder of the `external` organization role is the EXTERNAL principal — the org-wide default never widens it, and it reaches data only through shares, sharing rules and grant RLS

Clause-②: yes (widening: `@objectstack/core` gains `owdForAudience`, `isExternalAudienceContext`, `externalGrantSpeaks` and the two grant-stamp keys; every narrowing below applies only to the `external` role, which no release has shipped yet)
Metadata-protocol: semantic

Stage 2 of the `external` organization role (ruling of record 6355206139). Stage 1 kept externals off the member directory and the everyone-anchored default sets. This stage makes the role a posture of its own:

- **Audience and posture.** The authorization resolver stamps `audience: 'external'` on a holder's execution context, and `derivePosture` returns `EXTERNAL` for it. Platform admin still outranks it; tenant admin does not. The assembled context carries the audience to agents acting for an external, as it carries the posture.
- **The org-wide default.** For an external, every object's org-wide default is owner-only: it reads and writes the rows it owns and the rows shared to it, by a share or a sharing rule. A `public_read` or `public_read_write` object is not open to it. A `controlled_by_parent` detail is not floored on its own: its rows follow the master, which meets the floor, so an external reads the lines of a master shared to it.
- **Grant RLS lifts that floor.** When a permission set or position the external holds carries a row policy for the object (a `using` predicate, such as `supplier in current_user.<key>`), the object's own default stands and that policy bounds the rows. The object's declared default row scope and the platform's ownership floor do not count as a grant.
- **Writes.** `external_default` carries the platform's owner-only write floor (`owner_only_writes`, `owner_only_deletes`), bound to `org_external`, so an external never writes wider than a member. It shares the member floor's identity, so every relief that lifts a member's floor lifts an external's too.
- **Explain and describe** name the baseline an external resolves, `external_default`, as "external baseline (org_external)", and explain's OWD layer reports the owner-only floor when no held grant speaks.
- **Directory doors.** `list-teams` and `get-full-organization`'s `teams` answer an external only the teams it sits on. `list-invitations`, which better-auth gates on membership alone, answers an external only invitations to its own email.

Nothing changes for a principal that does not hold the `external` role.
