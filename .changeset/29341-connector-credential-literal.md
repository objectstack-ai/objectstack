---
'@objectstack/lint': patch
---

feat(lint): `connector-credential-literal` — `os validate`, `os build`, `os lint` and the connector save door warn on a credential-shaped literal in a connector's header or env map

Clause-②: yes (widening)
Three new exports on the `@objectstack/lint` entry and a new advisory on the connector save door; nothing is refused or narrowed.
Metadata-protocol: none

A declarative connector entry's four maps — `providerConfig.headers`, `providerConfig.defaultHeaders`, `providerConfig.transport.headers` and `providerConfig.transport.env` — are withheld whole on the metadata read path, but a literal credential in one of them is still stored in metadata. The same `credential-literal` predicate the `flow-credential-literal` advisory asks now judges those four maps and names each credential-shaped entry by its position (never its value), with the `auth.credentialRef` route:

- a header entry: move it to the connector's `auth: { type: 'bearer' | 'api-key' | 'basic', credentialRef }`, which the `rest` provider and an `mcp` http transport send themselves;
- a stdio `transport.env` entry: move it to the connector's `auth: { type: 'bearer' | 'api-key' | 'basic', credentialRef }` and name the variable in `providerConfig.transport.credentialEnv`; the `mcp` provider hands the resolved credential to the stdio server in that variable itself.

Always a `warning`; nothing is refused and every save lands. The rule runs on all three CLI commands and on the runtime publish gate for `connector` (`PUT /meta/connector/:name`), where it rides the save response's `advisories`. `os explain connector-credential-literal` carries the reasoning.
