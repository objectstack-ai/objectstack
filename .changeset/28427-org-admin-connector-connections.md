---
'@objectstack/plugin-security': patch
---

feat(plugin-security): organization administrators hold `manage_connector_connections` by default, so an organization's owners and admins can connect its OAuth2 connectors without a hand-bound permission set (ADR-0143 D5, ruling B)

Clause-②: yes (widening: the shipped `organization_admin` set, and `organization_admin_no_bypass` through its derivation, now admit their holders at the connector connection door; no other set changes)
Metadata-protocol: none

The connector connection door (`GET` / `POST` / `DELETE /api/v1/automation/connectors/:name/connection` and the OAuth callback) asks the organization-scoped `manage_connector_connections` capability. Until now only platform administrators held it by default, so an organization owner or admin was refused until someone granted it to them through a permission set.

- **Who gains it.** Every member whose organization role contains `owner` or `admin`, through the `organization_admin` set the platform already grants them per organization: `organization_admin` under a walled posture, `organization_admin_no_bypass` on a wall-less one. The no-bypass variant inherits the capability from `organization_admin`'s declaration; it is not a second list.
- **What it reaches.** Their own organization's connection only. The grant is scoped to the organization it was made in, and the door acts on the caller's active organization, so an organization admin who is a plain member elsewhere is still refused there. No token is ever shown to the holder.
- **Unchanged.** `member_default`, `viewer_readonly` and every other shipped set still hold the capability only by an explicit grant. No other capability of any set changes. An agent acting on behalf of an organization administrator resolves the administrator's system permissions as before, so it gains this one with them.
