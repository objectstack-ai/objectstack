---
'@objectstack/spec': patch
---

feat(spec): `ConnectorCredentialRejectedError` and the connector credential members of `IAutomationService`

Clause-②: yes (widening)
Metadata-protocol: none

Two additions for the connector credential store (#27237):

- `@objectstack/spec/integration` exports `CONNECTOR_CREDENTIAL_REJECTED`, `ConnectorCredentialRejectedError` (with `status`: 401 or 403) and the structural check `isConnectorCredentialRejected`. They sit beside the upstream-unavailable marker. A connector provider factory throws it when the upstream refuses the credential it sent, and the materializer then degrades the instance instead of failing the boot. The code is registered in the error-code ledger under `@objectstack/spec`.
- `IAutomationService` gains three optional members, `listConnectorCredentialRefs`, `setConnectorCredential` and `clearConnectorCredential`, with their types `ConnectorCredentialRef`, `ConnectorCredentialSetRequest` and `ConnectorCredentialClearRequest`. A listing entry never carries a value.

`PLATFORM_OBJECT_NAMES['service-automation']` lists the new `sys_connector_credential` object.
