---
'@objectstack/lint': patch
---

`validate-translation-references` now checks the `flows` group — an authored key naming a
flow, screen node or screen field that does not exist warns instead of resolving to nothing

The rule walked `objects`, `globalActions`, `apps` and `dashboards`; an unrecognised
top-level namespace is skipped and never reported, and `flows` was one of them. So a
bundle keyed to `flows.<name>.screens.<node_id>.fields.<field_name>` parsed, shipped, and
silently resolved to nothing — the wizard rendering its source-locale string while every
other label on the screen was translated, which is the exact failure this rule exists for,
one namespace over.

All three levels are exact-match identifiers with an enumerable universe, so the leg
mirrors the `dashboards` → `widgets` leg one level further: flow → `Flow.name`, screen →
`FlowNode.id` on `type: 'screen'` nodes, field → `ScreenFieldConfig.name`. Findings are
`warning`, like every other finding in this rule (ADR-0072 D1 — an orphan key is inert,
not broken), and each names the declared universe it resolved against.

Two shape facts the collector respects, both measured against the schemas rather than
assumed — either one read the obvious way would have made the leg a false-positive
generator:

- **Screen nodes nest.** A screen inside an ADR-0031 region (`loop.config.body`,
  `parallel.config.branches[].nodes`, `try_catch.config.try`/`.catch`) is a real screen the
  runner pauses on, so the universe is collected through `walkFlowNodes` rather than the
  flat `flow.nodes`.
- **`ScreenConfigSchema` has two mutually exclusive shapes.** An object-form screen
  (`config.objectName`) renders that object's own create/edit form and declares no
  `config.fields`; its input labels resolve through `objects.<objectName>.fields.*`, so a
  field key there is reported with that redirect rather than a bare "not declared".

A key naming a node that exists but is not a `screen` is diagnosed as the wrong node type,
not as a missing node.
