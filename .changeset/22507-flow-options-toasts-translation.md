---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/cli": minor
---

feat(i18n): a screen field's option labels and a flow's terminal toasts have translation keys (`flows.<flow>.screens.<node_id>.fields.<field>.options.<value>`, `flows.<flow>.successMessage` / `.errorMessage`)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A value-domain narrowing on one metadata shape, ScreenFieldConfigSchema's options array. No spec key, export, option, config field or stored shape is removed, renamed or re-shaped, so there is no tombstone and no rename for `objectstack migrate meta` to apply. What narrows is which option-value combinations one screen field accepts: two options whose values read the same as text are now refused at parse. There is no lossless rewrite for such a pair (nothing in the metadata says which of the two values the author meant, or what the other should become), and the refusal itself names the pair and the fix at every door that parses a flow. Measured reach is 0: no flow in this repository's examples carries such a pair. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered); and no published interface or type is narrowed, the new members being additive (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes. Two options of one screen field whose values read the same as text — `1` and `"1"`, `true` and `"true"`, or a repeated value — are now refused when the flow is parsed (`FlowSchema`, `objectstack validate`, the metadata save door, `registerFlow`), at the second option's `value`. Neither the option's label translation (keyed by the value as text) nor the console's select can tell such a pair apart. To fix a refused flow, give each option of the field a value that stays distinct as text, or drop the duplicate. Measured reach in this repository: 0 — no flow in its examples carries such a pair.

- **What is new.** A fully translated screen flow no longer has to keep its select options and its completion or failure toast in the source language. Translate an option's label under `flows.<flow_name>.screens.<node_id>.fields.<field_name>.options.<value>`, and the flow's own toasts under `flows.<flow_name>.successMessage` and `flows.<flow_name>.errorMessage`.
- **How an option is addressed.** By its value read as text: `String(value)`, so the option `{ value: 1, label: 'Tier 1' }` is translated under `options.1` and `{ value: true, … }` under `options.true`. `flowScreenFieldOptionKey(value)` (`@objectstack/spec/automation`) spells the key. Not by position (reordering options would re-point every translation), and not by an object field's options (a screen field declares no such binding).
- **One new refusal**, the narrowing the BREAKING note above describes: option values of one screen field must stay distinct as text, because the label translation is keyed by them.
- **The toasts translate only where the flow authors one.** A bundle cannot add a toast to a flow that declares none; `objectstack validate` refuses such a key (`translation-target-unknown`, error).
- **Where it is read.** `translateFlow` (`@objectstack/spec/system`) overlays both, and `resolveFlowScreenFieldOptions(bundle, flowName, nodeId, field)` resolves a served screen field's options. The console's flow runner reads them in a following release; until then a translation is stored and the authored text is drawn.
- **`objectstack validate`** warns on an option key that names no declared option of the field, or names it by its label (`translation-option-key-unknown`).
- **`os i18n extract` and the coverage gate** now scaffold and demand each screen field's option labels, the failure toast of every flow that declares one, and the completion toast of a flow with a screen, in the `flow` bucket (`i18n/missing-flow`). A project that declares `supportedLocales` gets one missing-key issue per locale for each until it translates them.
- **Still not keyed: a screen's `description`.** It is a `{{ }}` template the server renders per run, so its translation has to be chosen before that render; a translated `description` is still refused by the schema with that reason.
