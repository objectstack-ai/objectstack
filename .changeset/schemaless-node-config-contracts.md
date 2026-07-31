---
"@objectstack/spec": minor
"@objectstack/service-automation": patch
---

feat(spec,automation): publish executor-derived config contracts for the schemaless flow nodes (#4278)

The five descriptor-schemaless builtins (`decision` / `script` / `subflow` /
`wait` / `connector_action`) deliberately publish no `configSchema`, so their
Studio form lives only in objectui's hand-written `FLOW_NODE_CONFIG` table —
and nothing reconciled that table against the executors. `script` had drifted:
the form offered an `outputVariables` key nothing reads, two `actionType`
options (`sms` / `notification`) that fail every run, a no-op default (`code`),
and could not author the `function` / `inputs` / `outputVariable` path that
works.

New in `@objectstack/spec/automation` — contract exports only. Unlike their
`builtin-node-config.zod.ts` siblings, which #4277 wired into execute-time
parsing, no engine path `parse()`s node config with these: `script`'s legal key
set depends on `actionType` and `decision` may branch purely on edge
predicates, so a flat parse would either reject valid shapes or check nothing.
Their enforcement is the objectui reconciliation test.

- `ScriptConfigSchema` / `SubflowConfigSchema` / `DecisionConfigSchema` (+
  `DecisionConditionSchema`) — written from the executors in
  `service-automation`, the machine-readable half of the cross-repo
  reconciliation objectui's `flow-node-config` test now performs. `wait` and
  `connector_action` need no new schema — their contracts are the existing
  `FlowNodeSchema` sibling blocks (`waitEventConfig` / `connectorConfig`).
- `SCRIPT_BUILTIN_ACTION_TYPES` (`['email', 'slack']`) and
  `SCRIPT_INVOKE_FUNCTION_ACTION_TYPE` (`'invoke_function'`) — the `script`
  executor now builds its dispatch set from the published constant, so the
  designer's options, the dispatch set, and the "not a built-in action"
  failure message can no longer disagree.

Undeclared-alias graduation in the same change (Prime Directive #12, the
`map.flow` path): the `subflow` executor's bare `cfg.flowName ?? cfg.flow`
fallback is deleted, replaced by the ADR-0087 D2 conversion
`flow-node-subflow-flow-alias` — a stored `subflow` node authored with
`config.flow` is rewritten to the canonical `config.flowName` at load
(including the `AutomationEngine.registerFlow` rehydration seam). FROM
`config.flow` TO `config.flowName`; one-line fix for hand-maintained sources:
rename the key.
