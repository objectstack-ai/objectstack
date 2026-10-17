---
'@objectstack/metadata-protocol': minor
---

feat(metadata-protocol)!: a flow re-save that newly introduces a retired spelling is refused like a new flow's

Clause-②: yes (narrowing)

**BREAKING (API save door), the re-save case:** a flow saved through `saveMetaItem` (`PUT /api/v1/meta/flow/:name`, the runtime dispatcher, and every caller of the protocol) over a stored row is now judged as authored input when its body introduces a spelling retired from the authoring funnel that the stored row does not carry. Adding a node with an old spelling to a legacy flow, or writing one on a node the stored row holds in the canonical spelling, is no longer rewritten and stored: the save meets the flow parse's refusal, `422 INVALID_METADATA`, with an issue located at the key and the same prescription `os validate` and `os build` print, exactly as a new flow's does. Draft and publish mode alike. The whole body is judged that way, so the refusal also lists the retired spellings the stored row already carries; fixing the added one alone is enough to save. Before, a re-save healed every retired spelling in the body, the new one included, and said nothing.

What counts as introduced: a retired conversion that fires on the request at a site where it does not fire on the stored row. A site is the key's path, with each node (and edge) named by its `id` rather than its position, so moving, adding or removing nodes does not change it. The stored rows compared are the row the save overwrites, and for a draft save the active row the draft overlays as well, so Studio's repeated draft saves of a legacy flow keep saving.

Not changed:

- A re-save whose retired spellings the stored row all carries, such as the served legacy body saved back unchanged, keeps replaying the full chain and is healed as before.
- A new flow with a retired spelling is refused, as it was.
- The server's own writes of bodies at rest keep the full chain: the stored-metadata migration (`os migrate meta --stored`), a package duplicate and an unmanaged package import.
- The automation engine's flow rehydration and the read path, which still serves a stored flow verbatim.

Migration, for a client that edits flows through the API: write the spellings below on any node or key you add or change. The legacy spellings already on the stored row may stay until the row is healed.

- `wait` node loose `config.duration` / `config.timerDuration` → `waitEventConfig.timerDuration`; `config.signal` / `config.signalName` → `waitEventConfig.signalName`; `config.eventType` → `waitEventConfig.eventType`. On the block itself, `timeoutMs` → `timerDuration` and `onTimeout` is removed.
- `connector_action` node loose `config.connectorId` / `config.actionId` / `config.input` → its `connectorConfig` block.
- CRUD node `config.filters` → `config.filter`; `config.object` → `config.objectName`.
- `map` and `subflow` node `config.flow` → `config.flowName`.
- `notify` node `config.to` → `recipients`, `subject` → `title`, `body` → `message`, `url` → `actionUrl`, `source: { object, id }` → `sourceObject` / `sourceId`.
- `script` node `config.functionName` → `function`, `input` → `inputs`; `actionType` / `template` / `recipients` / `variables` / `script` are removed.
- `errorHandling.retryDelayMs` and a `try_catch` node's `retry.retryDelayMs` → `backoffMs`; the flow keys `active` / `template`, a node's `outputSchema` and `errorHandling.fallbackNodeId` are removed.

Each refusal names the key to write.

<!-- adr-0087: not-required (already-registered flow-node-crud-filter-alias, flow-node-crud-object-alias, flow-node-notify-config-aliases, flow-node-wait-event-config-lift, flow-node-map-flow-alias, flow-node-subflow-flow-alias, flow-node-connector-config-lift, flow-node-script-config-aliases, flow-inert-keys-removed, flow-node-wait-timeout-keys-removed, flow-node-script-branch-keys-removed, retry-policy-converged) these D2 entries already record every spelling the save door now refuses when a re-save introduces it; this change only stops the door replaying them for a re-save's new authored input, and their own migrations are the ones above -->
