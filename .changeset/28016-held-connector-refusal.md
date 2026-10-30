---
'@objectstack/service-automation': patch
---

fix(service-automation): a `connector_action` dispatch to a held connector instance names what recovers it, instead of saying the platform retries it

Clause-②: no
Metadata-protocol: none

A degraded connector instance that the platform does not retry (it is **held**) used to answer a dispatch with "Dispatch is unavailable until that is resolved; the platform retries automatically." Nothing retried it. Now the refusal names the fix:

- **A configuration fault met on a retry** (#27992), or **a credential written into the declaration that the upstream refused**: "Dispatch is unavailable until its declaration is edited (or the server restarts); the platform does not retry it."
- **A stored credential the upstream refused** (#27237): "Dispatch is unavailable until credential '<ref>' is set again (or the server restarts); the platform does not retry it."
- **An instance on the backoff** (an unreachable upstream, an environment or vault credential the upstream refused) keeps "the platform retries automatically".

The engine's degraded-connector record carries the hold: `registerDegradedConnector` takes an optional fifth argument, `RegisteredConnector` gains an optional `degradedHold`, and `AutomationEngine.getConnectorDegradedHold(name)` reads it. The engine's `Connector registered DEGRADED` warning no longer says the materializer retries a held instance. A degraded reason that ends with a full stop no longer gets a second one in the refusal.
