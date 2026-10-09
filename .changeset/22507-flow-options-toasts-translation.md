---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/cli": minor
---

feat(i18n): a screen field's option labels and a flow's terminal toasts have translation keys (`flows.<flow>.screens.<node_id>.fields.<field>.options.<value>`, `flows.<flow>.successMessage` / `.errorMessage`)

Clause-②: yes (widening, with one narrowing: the option-value collision refusal)

- **What is new.** A fully translated screen flow no longer has to keep its select options and its completion or failure toast in the source language. Translate an option's label under `flows.<flow_name>.screens.<node_id>.fields.<field_name>.options.<value>`, and the flow's own toasts under `flows.<flow_name>.successMessage` and `flows.<flow_name>.errorMessage`.
- **How an option is addressed.** By its value read as text: `String(value)`, so the option `{ value: 1, label: 'Tier 1' }` is translated under `options.1` and `{ value: true, … }` under `options.true`. `flowScreenFieldOptionKey(value)` (`@objectstack/spec/automation`) spells the key. Not by position (reordering options would re-point every translation), and not by an object field's options (a screen field declares no such binding).
- **One new refusal.** Two options of one screen field whose values read the same as text — `1` and `"1"`, `true` and `"true"`, or a repeated value — are refused when the flow is parsed (`FlowSchema`, `objectstack validate`, the metadata save door, `registerFlow`), at the second option's `value`. Neither its translation nor the console's select can tell such a pair apart. Give each option a value that stays distinct as text. No flow in this repository's examples carries such a pair.
- **The toasts translate only where the flow authors one.** A bundle cannot add a toast to a flow that declares none; `objectstack validate` refuses such a key (`translation-target-unknown`, error).
- **Where it is read.** `translateFlow` (`@objectstack/spec/system`) overlays both, and `resolveFlowScreenFieldOptions(bundle, flowName, nodeId, field)` resolves a served screen field's options. The console's flow runner reads them in a following release; until then a translation is stored and the authored text is drawn.
- **`objectstack validate`** warns on an option key that names no declared option of the field, or names it by its label (`translation-option-key-unknown`).
- **`os i18n extract` and the coverage gate** now scaffold and demand each screen field's option labels, the failure toast of every flow that declares one, and the completion toast of a flow with a screen, in the `flow` bucket (`i18n/missing-flow`). A project that declares `supportedLocales` gets one missing-key issue per locale for each until it translates them.
- **Still not keyed: a screen's `description`.** It is a `{{ }}` template the server renders per run, so its translation has to be chosen before that render; a translated `description` is still refused by the schema with that reason.
