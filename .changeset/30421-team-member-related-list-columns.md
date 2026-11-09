---
'@objectstack/platform-objects': patch
---

fix(platform-objects): a team membership is named by the person and the team, and a team's Members list shows the user and when they joined, not two raw ids

Clause-②: no
Metadata-protocol: none

- **The record title.** `sys_team_member`'s title (`display_title`) composed its two stored lookup ids, so a team's Members panel, a membership's own page and every reference to the row read `USER_ID in TEAM_ID`. It now reads the user's `name` (their `email` where the name is blank) and the team's `name`, one hop through each lookup (ADR-0079 addendum, 2026-10-18), as `sys_business_unit_member`'s title does: `Ada Lovelace in Core Platform`. Both hops are read as the reader: a user or team the reader may not read, or one that no longer exists, leaves the title empty rather than showing an id. No column is stored, so a renamed user or team is named anew on the next read.
- **The team page's Members list.** A related list with no authored columns leads with the record title (ADR-0079), so the Members list opened on a Title column beside the User column. The `team_id` lookup now declares `relatedListColumns: ['user_id', 'created_at']`: the list shows the user and when the membership began, drawn as declared, with no title column.
- **A user's Teams list.** The `user_id` lookup declares `relatedListColumns: ['team_id', 'created_at']`, for a user page that derives its related lists. Setup's own `sys_user_detail` page is authored and lists no teams, so it is unchanged.
