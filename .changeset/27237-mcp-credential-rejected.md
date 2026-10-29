---
'@objectstack/connector-mcp': patch
---

fix(connector-mcp): a credential the MCP server rejects is thrown as `ConnectorCredentialRejectedError`, so the instance is degraded instead of failing the boot

Clause-②: yes (widening)
Metadata-protocol: none

An HTTP 401 / 403 on connect, handshake or `tools/list` used to throw a plain `Error`, which failed the boot. The provider now throws `ConnectorCredentialRejectedError` from `@objectstack/spec/integration`, with the status and the SDK error as `cause`; its message no longer says the fault "is not retried", since whether it is now depends on where the credential came from. The automation service degrades the instance naming the refusal and marks a stored credential `rejected` (#27237). Every other connect or `tools/list` failure is unchanged.

An http instance whose handshake carried its credential (any auth but `none`, and not an api-key sent as a query parameter) now answers `credentialVerified: true`, so a stored credential the server accepted is recorded as verified.
