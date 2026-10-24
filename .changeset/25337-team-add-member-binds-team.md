---
'@objectstack/platform-objects': patch
---

feat: Add Member opened from a team now binds that team, so the dialog asks only for the user

Clause-②: no
Metadata-protocol: none

In Setup → Teams, Add Member lived only on the team-membership list's toolbar. No team is in hand there, so the dialog asked the administrator to pick the team again. `sys_team` now also declares `add_team_member`, on the team row (`list_item`) and the team record header (`record_header`). It calls the same `POST /api/v1/auth/organization/add-team-member` endpoint behind the same gates (the `organization` feature and the `add_team_member` membership grade). The team's id rides as `teamId` from the row it is opened on, and the dialog asks only for the user. The membership-list copy is unchanged and still asks for both.
