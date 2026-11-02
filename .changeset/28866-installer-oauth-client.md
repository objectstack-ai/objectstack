---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
---

feat(automation): an `oauth2` connector instance with `clientSource: 'installer'` connects with the OAuth client its administrator entered, and uses it for every exchange and refresh

Clause-②: yes (narrowing)
Metadata-protocol: none
Ruling-ref: 6566728470

An `authorization_code` instance that declares `clientSource: 'installer'` names no client in its definition. Its administrator registers a client with the vendor against this deployment's redirect URI and hands it to the connect door:

```http
POST /api/v1/automation/connectors/esign/connection
{ "clientId": "CLIENT_ID", "clientSecret": "CLIENT_SECRET" }
```

- **What it does.** The authorization request, the code exchange and every refresh of that connection go out as the administrator's client. Each organization's connection keeps its own client, and a reconnect replaces it. On `provider: 'mcp'` over http the MCP authorization flow still discovers the endpoints, and registers nothing.
- **Where the client is kept.** In the connection record's encrypted client column, the one that keeps a dynamically registered client. The id alone is also kept in plain text, so the connection's read shows `client: { source: 'installer', clientId, hasSecret }`. The secret is never answered back, logged or written to metadata.
- **What it refuses (400 `VALIDATION_ERROR`).** A connect of such an instance with no client: the message names the instance and the vendor registration step, with the redirect URI to register. A client offered to an instance that declares its own client or leaves it to dynamic registration, which used to be ignored. A body key other than `clientId` and `clientSecret` on the begin leg, which used to be ignored too. A client on the read or revoke leg. No refusal repeats a value the caller sent.
- **Contracts.** `ConnectorConnectionRequest` gains an optional `client`, and `ConnectorConnectionState` an optional `client`.
- **Unchanged.** An instance that declares its `clientId`, or leaves its client to MCP dynamic registration, connects, exchanges and refreshes exactly as before, and a begin with no body is still a begin with no client.

The `clientSource` key no longer carries `[PLANNED — not enforced]`, and the liveness ledger's `connector/auth` row no longer calls it planned.
