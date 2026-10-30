---
'@objectstack/lint': patch
---

fix(lint): a flow node config-value finding carries the slot's key path, so Studio's Problems row selects the node

Clause-②: no
Metadata-protocol: none

`validateStackExpressions` located a finding on a flow node's config value (an `expression-invalid` on an Update Records `fields` value, a node `condition`, a text slot, an undeclared config key, a `script` node with no `function`) by its `where` prose alone. The runtime authoring gate then used that prose as the finding's `path`, so a draft's `_diagnostics` entry for it could not be resolved to a node: Studio's Problems list showed the refusal but could not select or badge the node.

Each such finding now also carries the slot's key path, in the spelling a flow edge's `condition` finding uses: `flows[0].nodes[1].config.fields.status` (a draft's `_diagnostics` reads `nodes.1.config.fields.status`). A `connector_action` input value is located in its own block (`flows[0].nodes[2].connectorConfig.input.customerId`). The `where` prose and the message are unchanged. As for edges, a node inside a nested region (a `loop` body) and a map-form `flows` collection have no index to spell, so their findings keep `where` alone. The CLI's `rule: … at …` line prints the key path for these findings, as it does for an edge's.
