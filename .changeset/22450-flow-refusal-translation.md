---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/runtime": minor
"@objectstack/lint": minor
"@objectstack/cli": minor
---

feat(i18n): a refused `end` node's message translates in the run's locale (`flows.<flow>.refusals.<node_id>.message`)

Clause-②: yes (widening)

- **What is new.** An `end` node declaring `outcome: 'refused'` shows its `message` to the person who started the run. Translate it under `flows.<flow_name>.refusals.<node_id>.message`, keyed by the flow's `name` and the `end` node's `id`, the same addressing the `screens` keys use. Before this key, a refusal rendered in the source language on every console.
- **Keep the holes.** The translation is a `{{ }}` template like the message it translates (`'已拒绝:{{ record.name }} 是重复记录'`). A single-brace `{token}` in a translation is refused when the bundle is parsed, with the same text-slot refusal the source message gets.
- **Where it is read.** The engine picks the translated template before it renders the holes, through the `i18n` service, in the run's locale, and the run stores and returns that text (`refusalMessage`). With no translation for that locale, the authored message renders. `flowRefusalMessageKey(flowName, nodeId)` (`@objectstack/spec/system`) spells the key.
- **The run's locale.** `AutomationContext.locale` (`@objectstack/spec/contracts`) is new and optional. The trigger door (`POST /api/v1/automation/:name/trigger`, the legacy trigger route, a `type: 'flow'` endpoint) and the action door (`POST /api/v1/actions/...`, the MCP `run_action` bridge) set it from the request's resolved locale: `Accept-Language` first, then the `localization` settings. It is persisted with a paused run, so a resumed leg renders in the locale the run was started in. A run no person started (a record-change or schedule trigger) has no locale and stores the authored message.
- **`objectstack validate`** refuses a refusal key over an unknown flow, an unknown node, a completed `end` node, or a node of another type (`translation-target-unknown`, error).
- **`os i18n extract` and the coverage gate** now scaffold and demand the refusal message of every refusing `end` node in the `flow` bucket (`i18n/missing-flow`). A project that declares `supportedLocales` and has a refusing `end` with no translation now gets one missing-key issue per locale for it.
- **`AutomationEngine.setI18nServiceSource()`** (`@objectstack/service-automation`) attaches the `i18n` reader. The automation plugin wires it, so a host using `AutomationServicePlugin` needs no change. A host constructing the engine directly gets the authored message until it attaches one.
