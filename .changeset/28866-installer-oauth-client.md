---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
---

feat(automation): an `oauth2` connector instance with `clientSource: 'installer'` connects with the OAuth client its administrator entered, and uses it for every exchange and refresh

Clause-②: yes (narrowing)
Metadata-protocol: none
Ruling-ref: 6566728470

<!-- adr-0087: not-required (no-migration-prescription) No metadata key, schema, accepted value, stored row, export or error code is removed or renamed: the begin leg of the connector connection door now refuses, with the existing 400 VALIDATION_ERROR, a request body it used to drop unread, so nothing stored changes and there is nothing for objectstack migrate meta to rewrite, and the two contract types only gain OPTIONAL members no existing caller has to send. -->

**BREAKING** for three call shapes only, each of which used to be answered as if its extra input were absent and now answers `400 VALIDATION_ERROR` with nothing connected, read or revoked: a `POST /api/v1/automation/connectors/NAME/connection` whose JSON body carries a key other than `clientId` and `clientSecret`; the same begin carrying a client for an instance that does not declare `clientSource: 'installer'`; and an in-process `getConnectorConnection` or `revokeConnectorConnection` call whose request carries `client`. What to do: nothing, unless a caller sends a body to that begin leg. Send none (or `{}`) for an instance that declares its client or leaves it to MCP dynamic registration, and send only `clientId` and `clientSecret` for one that takes the installer's.

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
