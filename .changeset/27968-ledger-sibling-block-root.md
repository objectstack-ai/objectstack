---
'@objectstack/spec': minor
---

feat(spec)!: the flow-node expression ledger roots a path in a node's sibling block, and declares a `connector_action` node's `connectorConfig.input` a value slot

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-action-input-value-slot-judged -->

**BREAKING** accept-set narrowing of `connectorConfig.input` on `connector_action` flow nodes, served at `AutomationEngine.registerFlow` and `objectstack validate` (see the `@objectstack/service-automation` and `@objectstack/lint` entries). This package carries the ledger both doors read.

- **The ledger.** `FLOW_NODE_EXPRESSION_PATHS` could address a node's `config` only, so the one value map the executor reads from a sibling block — `connectorConfig.input`, evaluated before dispatch since the executor half landed — was declared nowhere and judged by no door. An entry may now name `block: 'connectorConfig'` (absent means `config`); `FLOW_NODE_SIBLING_EXPRESSION_BLOCKS` lists the blocks a path can be rooted in with the node type that reads each, and `FlowNodeExpressionBlock` / `FlowNodeSiblingExpressionBlock` / `FlowNodeSiblingBlocks` type them. The new entry is `connector_action` · `connectorConfig` · `input.*` · `value`.
- **The resolvers.** `resolveFlowNodeExpressions`, `resolveFlowNodeValueSlots` and `flowNodeValueTemplateRefusals` take an optional third argument, the node's sibling blocks (pass the node itself), and each result names the `block` its `path` is inside. A caller that passes none is answered for `config` only, exactly as before; every `config`-rooted result reads `block: 'config'`.
- **The declaration.** `FlowNodeSchema.connectorConfig.input`'s map value carries `.meta({ xExpression: 'value' })`, and `getFlowNodeSiblingBlockJsonSchemas()` hands the node's blocks other than `config` to the reconciliation ratchet as its third channel. The value stays `z.unknown()`: `FlowSchema.parse` does not judge the map, as it judges no value slot of a node's open `config`.
- **Unchanged.** Every `config`-rooted entry resolves byte-identically. The `FlowSchema` example comment no longer says `connectorConfig.input` is handed to the action as written.

**The remedy.** Write a computed input value as a CEL value envelope, `{ dialect: 'cel', source: 'record.id' }`, and a constant as the literal it is; a string that carried a `{…}` token takes the CEL spelling its refusal names (`'{rec.id}'` → `{ dialect: 'cel', source: 'rec.id' }`).
