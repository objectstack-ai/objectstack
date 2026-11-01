---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/service-automation': patch
'@objectstack/platform-objects': patch
---

feat(console): Connector connections, a Setup page to connect, reconnect or disconnect each OAuth connector instance and see its status

Clause-②: yes (widening: new Setup entry nav_connector_connections resolving automation:connector-connections; no existing key, route or shape changes)
Metadata-protocol: none

A connector instance declared with `auth: { type: 'oauth2', grant: 'authorization_code' }` needs an administrator to sign in to the vendor once for their organization. The Console now has a page for that (`automation:connector-connections`). `@objectstack/service-automation` contributes its Setup → Integrations entry, **Connector Connections**, gated on `manage_connector_connections`, the organization-scoped capability the connection door asks, so an organization administrator sees it; `@objectstack/platform-objects` carries the entry's label in its four Setup translation packs. The page lists every such instance with the organization's connection status as the server answers it (Not connected, Connected, or Reconnect required with the reason the server recorded), the granted scopes, who connected it and when, and when the access token renews. A `degraded` instance shows the server's reason in the same row as the connection that caused it.

**Connect** and **Reconnect** open the vendor's sign-in in its own window, detached from the page, and send it to the authorization URL the server answered. The page re-reads the status until the connect lands, then closes the window and shows the new status. **Disconnect** removes the connection after a confirmation. No token, code or authorization URL is ever rendered.
