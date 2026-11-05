---
'@objectstack/platform-objects': patch
---

fix(platform-objects): a team's Members list shows the user and when they joined, not a column of two raw ids

Clause-②: no
Metadata-protocol: none

- **The team page's Members list.** `sys_team_member`'s record title (`display_title`) is a formula over its two lookups, so it reads the stored ids (`USER_ID in TEAM_ID`). A related list with no authored columns leads with the record title (ADR-0079), so Setup → Teams → a team opened its Members list on that column beside the readable User column. The `team_id` lookup now declares `relatedListColumns: ['user_id', 'created_at']`: the list shows the user and when the membership began, drawn as declared, with no title column.
- **A user's Teams list.** The `user_id` lookup declares `relatedListColumns: ['team_id', 'created_at']`, for a user page that derives its related lists. Setup's own `sys_user_detail` page is authored and lists no teams, so it is unchanged.
- The record title itself is unchanged: a membership's own page and anything else that names the record still read `USER_ID in TEAM_ID`.
