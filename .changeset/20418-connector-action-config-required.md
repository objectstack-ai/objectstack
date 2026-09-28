---
'@objectstack/spec': minor
---

fix(spec)!: a `connector_action` flow node its executor cannot dispatch — no `connectorConfig` block, or an empty `connectorId` / `actionId` — is refused at authoring (#20418)

Clause-②: no (narrowing)

<!-- adr-0087: registered connector-action-config-required -->

**BREAKING** — an accept-set narrowing on authored `connector_action` flow nodes, shipped
as `minor` under the launch-window convention (`check-changeset-no-major` refuses `major`
until GA; breaking-ness is carried by this banner and the ADR-0087 disposition above, not by
the level).

**What changed.** A `connector_action` node's contract is its sibling `connectorConfig`
block — the executor reads nothing else, and refuses the node when `connectorId` or
`actionId` is empty. The block was optional on the node and both ids were any string inside
it, so `FlowSchema.parse`, `AutomationEngine.registerFlow` and `objectstack validate` all
admitted a node with no block, or with an empty id, and every run that reached the node then
failed at the executor's guard. The flow parse now refuses what that read refuses, at any
depth including an ADR-0031 region body, and `registerFlow` and `objectstack validate` meet
the refusal through that parse:

- **No `connectorConfig` block** — a `custom` issue at `nodes.N.connectorConfig`, whose
  message prescribes the block and says that keys left under `config` are not read.
- **`connectorId` or `actionId` empty, or only whitespace** — a `custom` issue at
  `nodes.N.connectorConfig.connectorId` / `.actionId`. Whitespace is refused with the empty
  string (the spec's one notion of blank): a connector `name` is a snake_case identifier, so
  it names nothing a dispatch can reach.

The rule is judged in the flow walk, not by `FlowNodeSchema` alone, so a node nested in a
`loop` / `parallel` / `try_catch` body is refused at the path the author wrote
(`nodes.N.config.body.nodes.M.connectorConfig`). `FlowNodeSchema.parse` of a lone node is
unchanged.

The Studio flow designer seeds a new connector node with `connectorId: ''` and
`actionId: ''`, so a connector node added and saved before it is configured is now refused
at save. Where such a node already sits, the whole flow is refused: registered from the
metadata registry or `sys_metadata` at boot, it is skipped with a `failed to register flow`
warn naming it while the flows beside it register; a `defineStack({ flows })` source throws
`StackSchemaInvalidError` for the whole stack; an artifact file is refused whole at load.

The `node-config-key-missing` refusal (`FLOW_SLOT_REFUSAL_CODES`) now describes the old
behaviour in the past tense — "the flow used to register, and then every run that reached
this node failed there" — because the doors that message is shown at refuse the flow.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ type: 'connector_action', label: 'Post' }` | the connector and the action it dispatches — `connectorConfig: { connectorId: 'slack', actionId: 'chat.postMessage', input: { channel: 'C0WINS000', text: 'Done' } }` |
| `connectorConfig: { connectorId: '', actionId: '' }` | the registered connector's `name` and one of its action keys — `{ connectorId: 'rest', actionId: 'request' }` |
| `config: { connectorId: 'slack' }` (no `actionId`, no block) | the complete pair in the block — `connectorConfig: { connectorId: 'slack', actionId: 'chat.postMessage' }` |

**One-line fix:** write the `connectorConfig` block the node dispatches by, or delete a
connector node you cannot configure yet — there is no placeholder connector.

**Unchanged.** A connector node carrying a complete block parses, registers and dispatches
as before, and `input` stays optional. A complete `connectorId` / `actionId` / `input` trio
written under `config` is still lifted into the block before `registerFlow` and
`objectstack validate` judge it (the `flow-node-connector-config-lift` conversion). Other
node types are not asked for a `connectorConfig`.
