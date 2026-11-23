---
'@objectstack/connector-slack': patch
---

feat(connector-slack): `ConnectorSlackPlugin`'s static bot `token` is optional

Clause-②: yes (widening)
Metadata-protocol: none

A deployment that only delivers Slack DMs with each organization's own token now composes the plugin without a placeholder: `new ConnectorSlackPlugin()` or `new ConnectorSlackPlugin({ fetchImpl })` registers the `slack` client service for caller-held tokens and skips the flow `connector_action` connector, logging that once at boot. An empty-string `token` reads the same as an absent one. With a token, behaviour is unchanged: the `slack` flow connector is registered exactly as before.

`ConnectorSlackPluginOptions` is now `SlackConnectorOptions` without `token`, plus `token?: string`; the constructor's options argument is optional. `SlackConnectorOptions.token` and `createSlackConnector` are unchanged (the connector still needs a token).
