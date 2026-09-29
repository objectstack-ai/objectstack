---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

A credential typed as a literal into a flow position that every flow reader is served now draws one `flow-credential-literal` warning at `os validate`, `os build`, `os lint` and the runtime publish gate, and the spec describes of those positions route an outbound credential to a declarative connector's `credentialRef` (#20654).

Clause-②: no

**Why.** A flow definition is served, as authored, to every member who can read flows. The flow read path withholds the credential slots the spec declares, but it cannot withhold a value inside an open map or a url, because it cannot tell a credential there from an ordinary value. The supported home for an outbound credential is a declarative connector: its `auth: { type, credentialRef }` names a secrets-layer reference that is resolved at boot and never stored in metadata.

**What the warning covers.** An `http` node's `config.headers` entry, a query parameter of an `http` node's `config.url`, and a node's `connectorConfig.input` at any depth, including nodes inside `try_catch`, `loop` and `parallel` regions. A value draws when it is a non-blank string with no `{…}` template, and either its name reads as a credential (`Authorization`, `Cookie`, `x-api-key`, a name carrying `token`, `secret`, `password` and similar) or it opens with an auth scheme (`Bearer`, `Basic`, `Token`, `Digest`, `ApiKey`) followed by a value. A `{variable}` template is resolved per run and draws nothing.

**What it does not do.** It never refuses: every finding is a `warning`, and a save, validate, build or lint that passed before still passes (`--strict` promotes it, as it promotes every warning). It never echoes the value it names. Nothing is withheld on any read.

**Fix, by where the credential sits.** Declare a `connectors:` entry with a `provider` and call it from a `connector_action` node. A header credential goes to `auth: { type: 'bearer', credentialRef }`, or to `auth: { type: 'api-key', headerName, credentialRef }` for a key in a named header. A key in the url's query string goes to `auth: { type: 'api-key', paramName, credentialRef }`. On a connector node, drop the credential from `input`: the connector authenticates through its own `auth.credentialRef`.

`@objectstack/lint` exports the rule `lintFlowCredentialLiterals`, its id `FLOW_CREDENTIAL_LITERAL`, and the one predicate it asks, `isCredentialShapedLiteral(name, value)`. In `@objectstack/spec`, only the descriptions of `HttpConfigSchema.headers` and a flow node's `connectorConfig.input` change; no shape changes.
