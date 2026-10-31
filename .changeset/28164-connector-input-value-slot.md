---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's `connector_action` form treats each `connectorConfig.input` value as a value slot

Clause-②: no
Metadata-protocol: none

The flow expression ledger roots `connector_action` `input.*` in the node's `connectorConfig` sibling block, and `registerFlow` refuses a `{…}` token there. Studio's readers ignored the entry's block, so the Input section offered no CEL-expression editor and showed no refusal: an author met the refusal only at publish.

- Each input value now has the text / CEL-expression toggle that other value slots have, in both the typed fields an action's `inputSchema` produces and the key/value repeater. An expression is stored as a CEL value envelope, `{ dialect: 'cel', source }`, at the same key.
- A `{…}` token typed into an input value shows the spec's refusal under the value as it is typed. The text is the same sentence the publish door gives.
- The Debug run fails a `connector_action` step whose input holds a `{…}` token, with the spec's refusal naming `connectorConfig.input.<key>`, because the executor refuses that input before it dispatches.
