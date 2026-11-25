---
'@objectstack/lint': patch
'@objectstack/cli': patch
---

fix(lint): the translation coverage check asks every named flow for its label, not only a flow with a screen or an approval step

Clause-②: no
Metadata-protocol: none

`flows.FLOW_NAME.label` is now demanded for every flow a stack declares with a `name`. Until now it was demanded only for a flow with a `screen` or `approval` node, the two readers the key used to have (the screen-flow runner and the approvals inbox). The docs viewer's `type: flow` embed titles its card by the same key for whichever flow a page names, record-triggered, scheduled and API flows included, and the check already asks every flow's drawn steps for their `nodes` labels. So a zh-CN reader saw an English flow name above translated step names, and `os lint` and `os i18n check` did not report it.

What you see after upgrading: `os lint` reports one more `i18n/missing-flow` finding per untranslated locale for each flow that has neither a screen nor an approval step, and `os i18n extract` scaffolds its `label`. Translate it under `flows.FLOW_NAME.label` in each locale bundle, the key the runner and the approvals inbox already read. A flow with no `name` is not asked: no bundle entry can address it.

The repository's own coverage ratchet rises by those labels: `examples/app-showcase` 425 to 449 (24 flows, one untranslated locale each) and `examples/app-todo` 130 to 136 (3 flows in two locales). The other twelve configs, including the ten bundle packages, are unchanged.
