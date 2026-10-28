---
'@objectstack/connector-mcp': patch
---

fix(connector-mcp): a credential the MCP server rejects is thrown as `ConnectorCredentialRejectedError`, so the instance is degraded instead of failing the boot

Clause-②: yes (widening)
Metadata-protocol: none

An HTTP 401 / 403 on connect, handshake or `tools/list` used to throw a plain `Error`, which failed the boot. The provider now throws `ConnectorCredentialRejectedError` from `@objectstack/spec/integration`, with the same message, the status, and the SDK error as `cause`. The automation service degrades the instance naming the refusal and marks a stored credential `rejected`, and it does not retry until the credential changes (#27237). Every other connect or `tools/list` failure is unchanged.
