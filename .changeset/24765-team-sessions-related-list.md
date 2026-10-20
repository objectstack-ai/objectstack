---
'@objectstack/platform-objects': patch
---

fix(platform-objects): a team record no longer lists Sessions with "Sign out other devices" (#24765)

Clause-②: no (narrowing)

**BREAKING** for a reader of a team's derived related lists only: Setup → Teams → a team → Related no longer lists *Sessions*. Shipped as `patch` under the launch-window convention.

- **Before.** `sys_session.active_team_id` is a lookup to `sys_team` that did not set `relatedList: false`, so every team record derived a Sessions related list. That list carried the session list's only toolbar action, "Sign out other devices", whose confirmation reads "Sign out of every other device where you're currently logged in?". The action signs out the administrator's own other sessions, not the team's.
- **Now.** `active_team_id` sets `relatedList: false`, so a team record derives no Sessions list. A team's Members and Invitations lists are unchanged.
- **Unchanged.** The `active_team_id` field, its lookup to `sys_team`, its label and its column: better-auth still writes `activeTeamId` there. A user record's Sessions tab (keyed on `user_id`), where "Sign out other devices" belongs, and the action itself.

**What to do.** Nothing. No team-scoped session action existed to lose.
