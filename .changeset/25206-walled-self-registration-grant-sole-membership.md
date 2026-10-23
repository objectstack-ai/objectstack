---
'@objectstack/cli': patch
---

feat(cli): the ownership ceremony gives a walled organization-less self-registration grant its user's sole membership's organization

Clause-②: no
Metadata-protocol: none

Before the self-registration grant waited for the registrant's first membership, a sign-up under `isolated` or `group` wrote the grant (`sys_user_permission_set`) with no organization. `os migrate organization-ownership` reported every such row as unattributable, so each one held certification until the operator assigned its organization by hand.

Under a wall the ceremony now derives the owner when the user's memberships (`sys_member`) all name one organization. That is where the runtime settles the grant today. The plan counts these rows under `sole-membership:user_id->sys_member`, and `--apply` writes them.

A grant stays reported, never guessed and never deleted, in three cases:

- its user is a member of several organizations, because which membership came first is not recorded;
- its user is a member of none;
- its user already holds the same permission set in that organization, because the grant's unique index would refuse the write.

Each reported row's reason names its case. The remedy is unchanged: assign the organization, or delete the row by hand, then re-run `--apply`. Under `single` nothing changes, and the Default Organization takes every organization-less grant.
