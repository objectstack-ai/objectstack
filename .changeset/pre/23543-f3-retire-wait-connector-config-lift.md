---
'@objectstack/spec': minor
'@objectstack/service-automation': patch
---

feat(spec)!: the loose `config` keys of a `wait` or `connector_action` flow node are refused, naming the `waitEventConfig` / `connectorConfig` key they belong on, and `flow-node-wait-event-config-lift` and `flow-node-connector-config-lift` leave the load path

Clause-②: yes (narrowing)

**BREAKING (authoring):** neither node type has a `config` contract: the `wait` executor reads only `waitEventConfig` and the `connector_action` executor only `connectorConfig`. Through 17 the loader lifted settings written under the node's `config` into that block with a notice. At 18 both ADR-0087 D2 conversions are retired from the load path (`retiredAfter: '17.7.0'`), and the flow parse refuses each such key where it is written, at every door that judges a flow (`defineStack`, `os validate`, `os build`, and `os lint` when the config calls it), a node inside a loop / parallel / try-catch region body included: "A `wait` node's `config.duration` was removed in @objectstack/spec 18 (ADR-0087 D2) … Move it to `waitEventConfig.timerDuration` …". The refused keys are exactly the ones the lifts moved: `eventType`, `timerDuration`, `duration`, `signalName`, `signal` and `timeoutMs` on `wait`; `connectorId`, `actionId` and `input` on `connector_action`. Any other `config` key on these node types is judged as before.

Migration:

- `wait` node `config.eventType` / `config.timerDuration` / `config.signalName` → the same key under `waitEventConfig`.
- `wait` node `config.duration` → `waitEventConfig.timerDuration`, and `config.signal` → `waitEventConfig.signalName`.
- `wait` node `config.timeoutMs` → `waitEventConfig.timerDuration`, as a string (`60000` → `'60000'`, or `'PT1M'`): it was only ever read as the timer duration.
- `connector_action` node `config.connectorId` / `config.actionId` / `config.input` → the same key under `connectorConfig`.
- If the block already sets the same key, the block's value is the one the node always ran with: delete the loose key.

Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand. The D3 entry `flow-sibling-block-loose-config-keys-refused` states the edit for upgraders.

Stored metadata needs no edit. The automation engine's flow rehydration (`registerFlow`), stored-row rehydration and the metadata save door's flow verdict still replay both conversions, and each now DELETES a loose key its block already shadows (and a loose key holding `null`) instead of leaving it in place, so a `sys_metadata` flow carrying either shape keeps loading with the block alone. A `connector_action` node whose `connectorId` / `actionId` pair is complete in neither place is refused as before: no conversion can complete it.

`@objectstack/service-automation`: comment-only changes in the `wait` and `connector_action` executors, which already read only their declared blocks.

<!-- adr-0087: registered flow-sibling-block-loose-config-keys-refused -->
