---
'@objectstack/platform-objects': patch
---

The organization's member, invitation and team actions are offered only to the membership grades the server admits. A plain member no longer sees "Invite User", "Change Role", "Remove Member", "Cancel Invitation", "Create Team" and the rest, each of which the server refused with 403.

- `invite_user` (on the Users, Members and Invitations lists) and `resend_invitation`: owner, admin and delegated_admin.
- `update_member_role`, `remove_member`, `cancel_invitation`, `create_team`, `update_team`, `remove_team`, `add_team_member` and `remove_team_member`: owner and admin.
- `transfer_ownership`: the owner alone, on a non-owner row.
- `add_member` is unchanged. Its door is platform-admin standing, not a membership grade.

Each action declares `requiresMembershipReach` from `@objectstack/spec`, which is lowered into its `visible` predicate.
