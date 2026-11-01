---
'@objectstack/spec': patch
---

feat(spec): `ConnectorUpstreamChangedError`, the marker for an upstream that no longer matches the instance's pin

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/spec/integration` exports `CONNECTOR_UPSTREAM_CHANGED`, `ConnectorUpstreamChangedError` and the structural check `isConnectorUpstreamChanged`, beside the upstream-unavailable and credential-rejected markers. A connector provider factory throws it when the upstream it contacted serves a definition that differs from a pin the instance declares. Today that is the `mcp` provider's `providerConfig.toolsSnapshot`: a pinned tool whose description or `inputSchema` changed, or a pinned tool the server no longer serves. The automation materializer degrades the instance with the factory's message as its reason and re-checks it on the same backoff as an outage, so a server that restores the pinned definition recovers it. `CONNECTOR_UPSTREAM_UNAVAILABLE` keeps its meaning: the upstream could not be reached. The code is registered in the error-code ledger under `@objectstack/spec`; no HTTP door answers with it.
