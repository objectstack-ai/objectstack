---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@object-ui/fields': minor
'@object-ui/i18n': minor
---

feat(spec,runtime): an organization-scoped `manage_connector_connections` capability gates the connector connection door (ADR-0143 D5)

Clause-②: yes (widening)
Metadata-protocol: added

Connecting a vendor account to an `oauth2` `authorization_code` connector instance is an organization act (ADR-0143 Q1 = A: one connection per instance per organization). The door that does it now asks a capability declared for exactly that act, instead of the platform-scoped `manage_metadata`.

- **`@objectstack/spec`**: `PLATFORM_CAPABILITIES` gains `manage_connector_connections` (label "Manage Connector Connections", scope `org`). A permission set may grant it in `systemPermissions`, and a resource may name it in `requiredPermissions`. `ADMIN_FULL_ACCESS_CAPABILITIES` carries it, so platform administrators (`admin_full_access`) hold it by default. No other shipped set carries it: an organization administrator, or anyone else, holds it only by an explicit grant.
- **`@objectstack/runtime`**: `GET` / `POST` / `DELETE /api/v1/automation/connectors/:name/connection` and `GET /api/v1/automation/connectors/oauth/callback` require `manage_connector_connections`, fail-closed, with only the system context bypassing. Without it they answer `403 PERMISSION_DENIED` before the automation service is reached. `manage_metadata` alone no longer admits a caller to these four routes. The door first shipped in this same release line gated on `manage_metadata`; no published version served it, so no released caller loses access. A platform administrator on `admin_full_access` is admitted as before.
- **`@object-ui/fields`, `@object-ui/i18n`**: the Setup capability picker labels the new capability in all ten locales.
