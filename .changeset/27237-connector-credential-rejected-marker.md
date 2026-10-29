---
'@objectstack/spec': patch
---

feat(spec): `ConnectorCredentialRejectedError` and the connector credential members of `IAutomationService`

Clause-②: yes (widening)
Metadata-protocol: none

Three additions for the connector credential store (#27237):

- `@objectstack/spec/integration` exports `CONNECTOR_CREDENTIAL_REJECTED`, `ConnectorCredentialRejectedError` (with `status`: 401 or 403) and the structural check `isConnectorCredentialRejected`. They sit beside the upstream-unavailable marker. A connector provider factory throws it when the upstream refuses the credential it sent, and the materializer then degrades the instance instead of failing the boot. The code is registered in the error-code ledger under `@objectstack/spec`.
- `ConnectorMaterialization` gains the optional `credentialVerified`. A provider factory sets it when the upstream accepted the instance's credential while materializing (the MCP handshake over http); the automation service then records the credential as verified, and a stored one marked `rejected` returns to `set`. A provider that first sends the credential on a call leaves it unset.
- `IAutomationService` gains three optional members, `listConnectorCredentialRefs`, `setConnectorCredential` and `clearConnectorCredential`, with their types `ConnectorCredentialRef`, `ConnectorCredentialSetRequest` and `ConnectorCredentialClearRequest`. A listing entry never carries a value.

`PLATFORM_OBJECT_NAMES['service-automation']` lists the new `sys_connector_credential` object.
