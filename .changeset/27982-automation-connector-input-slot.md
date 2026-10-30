---
'@objectstack/skills': patch
---

docs(skills): the automation skill teaches `connector_action`'s `connectorConfig.input` as an evaluated value slot, and the `openapi` provider's `providerConfig.include`

Clause-②: no
Metadata-protocol: none

- **`connectorConfig.input` is a value-slot map**, like `subflow` `input`: a top-level CEL envelope is evaluated in the run's scope, so a per-record payload (`{ dialect: 'cel', source: 'record.stripe_id' }`) is a declarative dispatch now. Any other value is sent as written; a `{…}` or `{{ }}` in it is literal text. The skill says plainly that `os validate` does not judge this slot yet, so a malformed envelope fails the step at run time.
- **`providerConfig.include` exists on the `openapi` provider**, with the `mcp` provider's allowlist meaning: absent exposes every operation, and a non-array or an unknown entry is a fatal configuration fault. Trimming the document is still taught, as the way to keep the package small, not as the only allowlist.
- The `integrations-declared` eval's first case follows: it no longer grades either stale limit.
