---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@object-ui/console': patch
---

fix(runtime): MCP `list_actions` marks an organization action the caller's membership role does not reach `unavailable`

Clause-②: no
Metadata-protocol: none

A plain organization member's agent was listed identity actions such as inviting a user, removing a member, editing the organization or managing its teams, and `run_action` then answered `403 PERMISSION_DENIED` from the organization endpoint each time. The actions stay listed, and for a caller whose membership role in the organization does not reach the endpoint the row now carries `unavailable: { code: 'PERMISSION_DENIED', reason }`, where the reason names the roles that do reach it (for example "needs an organization owner, admin or delegated admin"). The reach is read from the action's `target` against the `MEMBERSHIP_REACH` table in `@objectstack/spec/identity`. Owners, admins and (for invitations) delegated admins see the rows unmarked. Nothing is hidden and neither run door reads the mark, so who can run each action is unchanged. Actions judged on record ownership or on the deployment's tenancy posture (deleting an SSO provider or an OAuth application, creating an organization) are not marked. The `list_actions` tool description, the `McpActionSummary.unavailable` documentation and the served skill (with its Console mirror) now say a listed action can carry `unavailable` for the caller's role, not only for its credential.
