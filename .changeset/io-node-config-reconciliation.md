---
'@objectstack/spec': minor
'@objectstack/service-automation': patch
---

Reconcile the flat IO nodes' declared config against what their executors read
(#4045 — the notify / http / connector step of the declared-vs-read worklist).

**`notify` / `http` gain executor-derived Zod contracts.**
`NotifyConfigSchema` and `HttpConfigSchema` (`automation/io-node-config.zod.ts`)
were written by reading the executors — not by transcribing the descriptors'
hand-written `configSchema` literals — and a new ledger test
(`io-node-form-zod-ledger.test.ts`) compares the two key sets bidirectionally.
Because the sides are independently written, agreement is evidence rather than
tautology: a key survives only if the form offers it AND the executor reads it.
Both nodes reconcile clean, with no deliberately-shallow ledger — their configs
are flat and fully closed. Like the control-flow config Zods, these are contract
exports: no engine path parses with them yet (that is #4045 step 3b, gated on
the #4059 warning data).

**`connector_action`'s mis-rooted `configSchema` is retired — it broke
schema-driven authoring.** The executor reads only the declared
`FlowNodeSchema.connectorConfig` sibling block, but the descriptor published a
`configSchema` declaring `connectorId`/`actionId`/`input` as `config` keys. A
published `configSchema` describes `node.config` by contract, and the Studio
inspector derives its property form from it — rooting every field at
`config.<key>` and replacing the client's hand-written `connectorConfig` form
(with its connector/action pickers). So authoring a connector node against a
live backend wrote the trio where nothing reads it, and the node refused to
dispatch. The descriptor now publishes no `configSchema` (joining `wait`'s
deliberately-schemaless class), which drops the online designer back onto the
correct sibling-block form with no client change.

**Stored flows that carry the mis-taught shape are healed at load.** A new
ADR-0087 D2 conversion, `flow-node-connector-config-lift` (protocol 17, retires
at 18), lifts `config.{connectorId,actionId,input}` onto the declared
`connectorConfig` block — including the `AutomationEngine.registerFlow`
rehydration seam. Declared keys win (the loose counterpart stays shadowed), and
a lift that cannot complete the required `connectorId`+`actionId` pair leaves
the node untouched, so a step-time refusal never becomes a load failure.

**`connectorConfig.input` is now optional**, matching what was always true: the
executor dispatches with `input ?? {}` and the designer's keyValue editor omits
an empty map entirely — so the required `input` declared in the spec turned a
no-input connector action into a `registerFlow` parse failure nothing
downstream asked for.
