---
'@objectstack/spec': minor
---

An action can declare which organization membership grades it is offered to: `requiresMembershipReach` names a row of the new `MEMBERSHIP_REACH` table and is lowered at parse time into `visible`, the way `requiresFeature` is.

Clause-②: yes (widening)

- **`MEMBERSHIP_REACH`** (`@objectstack/spec/identity`) says which membership grades reach which better-auth organization endpoint. `invite_member` is reached by owner, admin and delegated_admin. `cancel_invitation`, `update_member_role`, `remove_member`, `create_team`, `update_team`, `remove_team`, `add_team_member` and `remove_team_member` are reached by owner and admin. `transfer_ownership` (setting the creator role on a member) is reached by the owner alone. The rows are read off better-auth's own access-control statements plus the `delegated_admin` registration, and plugin-auth pins them equal to the door. It is reach, not authority (ADR-0108 D1): a fourth fact beside the membership names, the administrative-grade rule and the identity projection, and merged into none of them. Also exported: `MEMBERSHIP_REACH_NAMES`, `membershipReachPredicate`, `lowerRequiresMembershipReach`, and the `MembershipReachEntry`, `MembershipReachName` and `MembershipReachStatement` types.
- **`ActionSchema.requiresMembershipReach`** is optional and enum-checked against the table's row names. At parse time it becomes one `'<name>' in current_user.positions` term per grade, in the names `mapMembershipRole` projects them to (`org_owner`, `org_admin`, `delegated_admin`). The terms are AND-composed with an explicit `visible`, and the key is stripped from the parsed output. It composes ahead of `requiresFeature`, so a feature gate stays the last term. `visible: false`, a non-CEL or AST-only `visible`, and a blank `source` are refused at parse time, at the key.
- It is UI courtesy, not authorization: the endpoint's own door stays the authority. The capability channel (`current_user.can`) is unchanged and carries no grade (ADR-0108).

Nothing that parsed before is refused now, and an action without the key lowers exactly as before.
