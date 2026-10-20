---
'@objectstack/platform-objects': patch
---

fix(platform-objects): a team record no longer lists Sessions with "Sign out other devices" (#24765)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) One shipped object field gains `relatedList: false`, a key it was always free to set. No spec key, authorable spelling, export, type or stored shape is added, removed or renamed, and no stored row or column is read or rewritten, so `objectstack migrate meta` has nothing to rewrite. What narrows is one derived related list on a team's served detail page. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this field (not already-registered); and the change is metadata on a shipped object, not an interface, a type or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a reader of a team's derived related lists only: Setup → Teams → a team → Related no longer lists *Sessions*. Shipped as `patch` under the launch-window convention.

- **Before.** `sys_session.active_team_id` is a lookup to `sys_team` that did not set `relatedList: false`, so every team record derived a Sessions related list. That list carried the session list's only toolbar action, "Sign out other devices", whose confirmation reads "Sign out of every other device where you're currently logged in?". The action signs out the administrator's own other sessions, not the team's.
- **Now.** `active_team_id` sets `relatedList: false`, so a team record derives no Sessions list. A team's Members and Invitations lists are unchanged.
- **Unchanged.** The `active_team_id` field, its lookup to `sys_team`, its label and its column: better-auth still writes `activeTeamId` there. A user record's Sessions tab (keyed on `user_id`), where "Sign out other devices" belongs, and the action itself.

**What to do.** Nothing. No team-scoped session action existed to lose.
