---
'@objectstack/metadata-protocol': minor
'@objectstack/service-automation': minor
---

feat(metadata-protocol)!: the metadata save door refuses a retired flow spelling on a NEW flow, and a stored flow keeps re-saving

Clause-②: yes (narrowing)

**BREAKING (API save door):** a flow saved through `saveMetaItem` (`PUT /api/v1/meta/flow/:name`, the runtime dispatcher, and every caller of the protocol) with no stored row of that name at the save's address is now judged as authored input. It is canonicalized without the ADR-0087 D2 conversions retired from the authoring funnel, so a spelling the loader stopped lifting at 18 is no longer rewritten and stored: it meets the flow parse's refusal, `422 INVALID_METADATA`, with an issue located at the key and the same prescription `os validate` and `os build` print. Draft and publish mode alike. Before, the door lifted the old spelling, stored the new one and said nothing, so the client that wrote it (an AI writing flows through MCP or REST above all) was never told and wrote it again.

What counts as a stored row: the row the save overwrites, at its state and package, and for a draft save with no draft yet the active row the draft overlays, so Studio's first draft edit of a stored flow is a re-save.

Not changed:

- A re-save of a stored flow keeps replaying the full chain, retired entries included, so a legacy row stays editable and is healed by the save, exactly as before.
- The server's own writes of bodies at rest keep the full chain: the stored-metadata migration (`os migrate meta --stored`), a package duplicate and an unmanaged package import.
- The automation engine's flow rehydration (`registerFlow`) and the read path, which still serves a stored flow verbatim.

Migration, for a client that creates flows through the API:

- `wait` node loose `config.duration` / `config.timerDuration` → `waitEventConfig.timerDuration`; `config.signal` / `config.signalName` → `waitEventConfig.signalName`; `config.eventType` → `waitEventConfig.eventType`. On the block itself, `timeoutMs` → `timerDuration` and `onTimeout` is removed.
- `connector_action` node loose `config.connectorId` / `config.actionId` / `config.input` → its `connectorConfig` block.
- CRUD node `config.filters` → `config.filter`; `config.object` → `config.objectName`.
- `map` and `subflow` node `config.flow` → `config.flowName`.
- `notify` node `config.to` → `recipients`, `subject` → `title`, `body` → `message`, `url` → `actionUrl`, `source: { object, id }` → `sourceObject` / `sourceId`.
- `script` node `config.functionName` → `function`, `input` → `inputs`; `actionType` / `template` / `recipients` / `variables` / `script` are removed.
- `errorHandling.retryDelayMs` and a `try_catch` node's `retry.retryDelayMs` → `backoffMs`; the flow keys `active` / `template`, a node's `outputSchema` and `errorHandling.fallbackNodeId` are removed.

Each refusal names the key to write. `os migrate meta --from 16` lists the same edits for source files. Rows already stored need nothing.

`@objectstack/service-automation`: `AutomationEngine.canonicalizeStoredFlow(name, definition, options?)` takes `{ includeRetired?: boolean }`. Omitted, it is `true` (the full chain, as every caller holding a body at rest wants). `false` is the authoring posture the save door asks for. `registerFlow` does not take the option.

<!-- adr-0087: not-required (already-registered flow-node-crud-filter-alias, flow-node-crud-object-alias, flow-node-notify-config-aliases, flow-node-wait-event-config-lift, flow-node-map-flow-alias, flow-node-subflow-flow-alias, flow-node-connector-config-lift, flow-node-script-config-aliases, flow-inert-keys-removed, flow-node-wait-timeout-keys-removed, flow-node-script-branch-keys-removed, retry-policy-converged) these D2 entries already record every spelling the save door now refuses on a new flow; this change only stops the door replaying them for authored input, and their own migrations are the ones above -->
