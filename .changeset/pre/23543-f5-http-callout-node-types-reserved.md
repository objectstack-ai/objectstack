---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

feat(spec)!: the retired callout node types `http_request`, `http_call` and `webhook` are reserved inside the open flow-node namespace; `flow-node-http-callout-rename` leaves the load path

Clause-②: yes (narrowing)

**BREAKING (authoring):** ADR-0018 unified the three outbound callout node types `http_request`, `http_call` and `webhook` into the one `http` node, and through 17 the loader rewrote an authored node typed with one of them to `http` with a notice. A flow node's `type` is an open namespace (a plugin registers its own node types), so nothing refused the old names. At 18 they are reserved: the flow parse refuses each as a node's `type` by name, the automation engine refuses to register a node executor under one, and the ADR-0087 D2 conversion `flow-node-http-callout-rename` (protocol 11) is retired from the load path (`retiredAfter: '17.7.0'`). A wait node's `waitEventConfig.eventType: 'webhook'` is a different field and is not affected.

## FROM → TO

| you wrote (17.7 and earlier) | write instead |
| --- | --- |
| a flow node `type: 'http_request'` | `type: 'http'` |
| a flow node `type: 'http_call'` | `type: 'http'` |
| a flow node `type: 'webhook'` | `type: 'http'` |
| a plugin's `engine.registerNodeExecutor({ type: 'webhook', … })` (or either other name) | a type of your own, e.g. `'acme_webhook'` |

**The one-line fix:** change the node's `type` to `'http'`; the node's `id`, `label` and `config` stay as they are (the conversion never touched `config`, so the `http` contract judges it as written).

**What an author who still writes it sees.** The parse refuses the node at its own `type` path — a top-level node and a node inside a `loop`, `parallel` or `try_catch` region alike. `defineStack` throws `STACK_SCHEMA_INVALID` (422), `os validate`, `os build` and `os lint` (whose config calls `defineStack`) print the issue, and the metadata save door answers a NEW flow with `422 INVALID_METADATA` at the node's `type`, with or without an automation service, and stores nothing:

> Flow node `type: 'http_request'` was removed in @objectstack/spec 18 (ADR-0087 D2) — it is one of the three callout node types ADR-0018 unified into `http`, the loader rewrote it to `http` until this release, and the name stays reserved inside the open node namespace so no plugin can claim it (ADR-0018). Use `type: 'http'`. Change the value; the conversion never touched the node's `config`, so the `http` contract judges it as written.

The refusal is a `pattern` on `FlowNodeSchema.type`, so the published JSON Schema carries it too.

**`@objectstack/service-automation`:** `AutomationEngine.registerNodeExecutor` (and `registerNodeAlias`, which calls it) throws when the executor's `type` or its descriptor's `type` is one of the three names, and registers nothing. No node could ever reach such an executor: an authored node with the name is refused at parse, and a stored one is rewritten to `http` before it parses. A plugin that registered its own executor under one of these names fails at that call and needs a type of its own.

**No tool makes the rename.** The conversion belongs to protocol 11, below the migration floor, so `objectstack migrate meta` applies no edit for it and `--write` writes none: it prints each such node among the refusals the migrated stack still has, at `flows.N.nodes.M.type`, and lists the D3 entry `flow-node-http-callout-types-reserved` as the hand edit.

**Stored metadata needs no edit.** Stored-row rehydration, the automation engine's flow rehydration and the artifact-ingestion door inside its window still replay the conversion, so a `sys_metadata` flow row written with an old name keeps loading as an `http` node. The rewrite there is now unconditional: until 18 it skipped a node whose old name a live executor owned and reported a conflict, and the engine no longer lets such an executor exist.

## The retirement kit

- **The reserved-name table** `FLOW_RESERVED_NODE_TYPES` and its refusal `reservedFlowNodeTypeRefusal` (`@objectstack/spec/automation`), read by the flow parse, the engine's registration refusal and the conversion itself.
- **The conversion** is `retiredFromLoadPath: true`, `retiredAfter: '17.7.0'`; its ADR-0078 conflict guard is gone.
- **The D3 entry `flow-node-http-callout-types-reserved`.**
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` and `@objectstack/service-automation` are published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered flow-node-http-callout-types-reserved -->
