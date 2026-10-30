---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta --stored` lists a stored `connector_action` node whose `connectorConfig.input` carries a `{…}` token, which boot refuses

Clause-②: no
Metadata-protocol: none

- **Before.** The stored-shape listing judged a flow node's value slots with the node's `config` alone, so it never read the value slot rooted in a `connector_action` node's `connectorConfig.input`. A stored flow with `input: { text: '{record.name}' }` was refused by `registerFlow` at boot (skipped with a `warn`, its trigger not armed), yet the preview listed nothing for it.
- **Now.** The listing hands the value-slot judge the whole node, as `registerFlow` and `objectstack validate` do, so it lists such a value as a TODO under the `connector-action-input-value-slot-judged` entry, by flow, node and path (`connectorConfig.input.text`), with the value's CEL spelling. A loose `config.input` the conversions lift onto `connectorConfig` is listed at its lifted path. Nothing is rewritten.
- **Unchanged.** A `config` value slot is listed under `flow-value-slot-template-dialect-refused`, as before. A CEL value envelope or a literal in `connectorConfig.input` is not listed.
