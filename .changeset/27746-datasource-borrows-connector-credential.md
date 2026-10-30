---
'@objectstack/types': patch
'@objectstack/service-automation': patch
'@objectstack/service-datasource': patch
'@objectstack/driver-odata': patch
---

feat: a datasource that names a connector instance in `external.connector` borrows that instance's credential at runtime, and its driver presents it per request

Clause-②: yes
Metadata-protocol: none

The runtime half of ADR-0015 amendment D7. A datasource over a vendor API that names a declared connector instance now reads with that instance's credential — the one set under Setup → Connector credentials (or the instance's environment variable, or the host's resolver) — so one credential serves the connector's flow actions and the datasource's virtual objects:

```ts
connectors: [{ name: 'sap_s4', type: 'api', provider: 'openapi', providerConfig: { spec: './sap-openapi.json' },
  auth: { type: 'bearer', credentialRef: 'sap_token' } }],
datasources: [{ name: 'sap_orders', driver: 'sap_orders', config: {},
  schemaMode: 'external', external: { connector: 'sap_s4' } }],
// served by createODataDriverPlugin({ name: 'sap_orders', serviceRoot: '…' }), its auth left at 'none'
```

- **`@objectstack/service-automation`** registers a `connector-credential-source` service that lends a declared instance's credential (bearer, API key, basic), resolved through the same chain the connector itself uses. A credential set or changed through the credential door is picked up by the datasource's next request, with no restart.
- **`@objectstack/service-datasource`** borrows it when such a datasource connects (a plugin driver the engine already adopted from its `driver.<name>` service is judged at that connect too), is probed (Test connection) or is saved from the admin door, and hands the driver factory a credential handle on `DatasourceConnectionSpec.credential`. A datasource whose instance is not declared, is a catalog descriptor, has no `auth` credential or is disabled — or a stack with no automation service to lend it — is refused, fail-closed, with a reason naming the fix: it never connects to fail its first read with an upstream 401.
- **`@objectstack/driver-odata`** presents it: a datasource it serves that names `external.connector` borrows the handle at its first request and sends every request through `callWithBorrowedCredential`, in the form the instance's `auth` declares (bearer, basic, or an API key as a header or query parameter). An upstream's error text is stripped of every spelling of the presented credential before it is thrown (`withoutBorrowedCredential`), so an API key sent as a query parameter never reaches an error body through a service that echoes the request URI. `external.credentialsRef` keeps its path; both channels at once, or an `auth.scheme` set on the plugin beside the connector, refuse the request.
- **`@objectstack/types`** carries the contract (`IConnectorCredentialSource`, `ConnectorCredentialHandle`, `CONNECTOR_CREDENTIAL_SOURCE_SERVICE`) and `callWithBorrowedCredential`, the one rule a plugin driver presents a borrowed credential by: refreshed when it has expired, refreshed once and retried on a `401`, and a `503 SERVICE_UNAVAILABLE` naming the instance when the fresh one is refused too.

Nothing changes for a datasource that binds its own secret with `external.credentialsRef`. The handle answers the grant-bearing kinds (OAuth2 and the app-credential exchange) through the same interface when connector instances can declare them; a driver written against it today needs no change then.
