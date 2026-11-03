---
'@objectstack/spec': patch
---

docs(spec): the `ConnectorConnectionState.redirectUri` TSDoc names the service that sets it

Clause-②: no
Metadata-protocol: none

The `ConnectorConnectionState.redirectUri` docblock no longer says that no answer carries the key. It now names its producer: `AutomationServicePlugin.getConnectorConnection` in `@objectstack/service-automation` sets it whenever the redirect URI derivation has a base, and it is absent otherwise. Prose only: no type, schema or accepted value moves.

**Supersedes, in the same release.** The `@objectstack/spec` note "Declared ahead of the service" (until the automation service sets the key, no answer carries it) no longer holds: the `@objectstack/service-automation` note in this release says the connection read now answers `redirectUri`.
