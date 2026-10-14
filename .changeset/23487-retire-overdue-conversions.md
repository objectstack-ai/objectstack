---
'@objectstack/spec': minor
---

feat(spec)!: seven overdue ADR-0087 D2 conversions leave the load path at 18 — six flow-node config aliases and a sharing rule's `accessLevel: 'full'` are refused with their rename at every door that judges a flow or a sharing rule

Clause-②: no (narrowing)

**BREAKING (authoring):** seven ADR-0087 D2 conversions whose one-major window had already run are now retired from the load path: `flow-node-crud-object-alias`, `flow-node-notify-config-aliases`, `flow-node-map-flow-alias`, `flow-node-subflow-flow-alias`, `flow-node-script-config-aliases` and `sharing-rule-access-level-full-to-edit` (protocol 17's window), and `flow-node-crud-filter-alias` (protocol 11's). The authoring funnel (`defineStack`, `os validate`, `os build`, `os lint`) no longer rewrites these spellings. An author who still writes one meets the refusal of the surface's own contract, and every one of those refusals is now the upgrade prescription: it names the canonical key and the release that refuses the old spelling. The flow-node prescriptions used to say "the conversion rewrites it at load". `accessLevel: 'full'` used to get zod's bare "Expected one of: read, edit"; `SharingLevel` now names `edit`.

Migration:

- CRUD node (`get_record` / `create_record` / `update_record` / `delete_record`) `config.object` → `config.objectName`, and `config.filters` → `config.filter`. Rename the key; the value is unchanged.
- `notify` node `config.to` → `recipients`, `config.subject` → `title`, `config.body` → `message`, `config.url` → `actionUrl`, and a nested `config.source: { object, id }` → the flat pair `sourceObject` / `sourceId`. Rename (or move) the key; the value is unchanged.
- `map` and `subflow` node `config.flow` → `config.flowName`. Rename the key; the value is unchanged.
- `script` node `config.functionName` → `config.function`, and `config.input` → `config.inputs`. Rename the key; the value is unchanged. (`connectorConfig.input` on a `connector_action` node is canonical; leave it.)
- Sharing rule `accessLevel: 'full'` → `accessLevel: 'edit'`. `full` never granted more than `edit`.
- If a config carries both spellings with different values, decide which one you mean, keep it under the canonical key, and delete the old one.

Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand. (`config.filters` belongs to protocol 11, below the migration floor, so `os migrate meta` does not list it: rename that one by hand.)

Stored metadata needs no edit. The automation engine's flow rehydration and stored-row rehydration still replay the whole conversion chain, these seven entries included, so `sys_metadata` flows and sharing-rule rows written under an old spelling keep loading in canonical form. A built artifact whose declared protocol floor is at or below `17.7.0` is also still converted at the artifact-ingestion door.

Eight more entries below 18 stay on the load path, each with the reason recorded in its docblock: `flow-node-http-callout-rename` and `page-kind-jsx-to-html` (the old value is still accepted by its schema), `view-visibleOn-to-visibleWhen` and `page-component-visibility-to-visibleWhen` (the schema still declares and folds the deprecated key), `flow-node-wait-event-config-lift` and `flow-node-connector-config-lift` (the node's `config` has no contract to refuse the loose keys), `datasource-driver-mongo-to-mongodb` and `retry-policy-converged`.

<!-- adr-0087: not-required (already-registered flow-node-crud-object-alias, flow-node-crud-filter-alias, flow-node-notify-config-aliases, flow-node-map-flow-alias, flow-node-subflow-flow-alias, flow-node-script-config-aliases, sharing-rule-access-level-full-to-edit) All seven D2 conversions are registered in their migration steps before this change, and they are the whole mechanical migration: this diff marks them retiredFromLoadPath with retiredAfter 17.7.0 and makes the refusals an author now meets name the release, so the authoring funnel stops replaying them while os migrate meta, stored-row and flow rehydration and the artifact door keep replaying them. No key, value or shape is added or removed, so there is no new D2 conversion and no D3 semantic judgment to register: each rewrite is a lossless rename. -->
