---
'@objectstack/service-datasource': patch
---

Datasource-admin HTTP routes now require the `manage_platform_settings` capability, not merely authentication.

All eleven routes under `/api/v1/datasources` — list, read, driver catalog, remote-table
introspection, connection probes, credential migration, create, patch and remove — answer
`403 PERMISSION_DENIED` to a caller that resolves to an identity holding no
`manage_platform_settings` grant. The anonymous floor is unchanged (`401 UNAUTHENTICATED`).

The capability is matched to what the adjacent Setup-admin families already gate on, not
minted: `@objectstack/service-settings`'s platform-infrastructure namespaces (`mail`,
`storage`, `sms`, `auth`, `ai`, `knowledge`) declare it for reads and writes alike, and this
service's own Setup nav entry already declared `requiredPermissions:
['manage_platform_settings']` for the console door in front of these routes. There is no
read/write split for the same reason those namespaces have none: a datasource read returns
stored connection configuration and live remote-schema introspection.

Impact: `admin_full_access` carries `manage_platform_settings`, so platform admins are
unaffected. A deployment that granted non-admin users access to Setup → Datasources through
some other capability must now grant `manage_platform_settings` (or bind those users to a
permission set carrying it).
