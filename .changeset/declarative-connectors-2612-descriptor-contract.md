---
'@objectstack/service-automation': minor
'@objectstack/spec': patch
---

feat(automation): descriptor-only contract + boot audit for declarative `connectors:` (#2612)

Declarative `connectors:` stack entries never reach the automation engine's
connector registry — only plugins populate it via
`engine.registerConnector(def, handlers)` (ADR-0018 §Addendum) — so a declared
connector with actions and no plugin behind it *looked* dispatchable but was
silently inert.

The contract is now explicit and audited:

- **Boot audit (service-automation).** At `kernel:ready` (and again on
  `metadata:reloaded`), declared connectors with `actions` but no same-name
  runtime registration log a loud warning naming each inert entry and
  pointing at the fix (install the matching connector plugin, or mark a
  deliberate catalog entry). Nothing is registered on your behalf — the
  warning surfaces the gap `connector_action` would otherwise hit at
  dispatch time.
- **`enabled: false` = deliberate catalog descriptor (spec).** Setting it on
  a declarative entry documents "descriptor-only on purpose" and silences the
  audit. Schema docs on `stack.zod.ts` (`connectors:`) and
  `integration/connector.zod.ts` now state the descriptor-vs-registered
  contract explicitly (including for AI stack authoring via `.describe()`).

Declarative provider-bound connector *instances* — entries a generic executor
(connector-openapi / connector-mcp) materializes into live connectors at boot,
upgrading this warning to a hard error — are specified in ADR-0096 and tracked
in #2977.
