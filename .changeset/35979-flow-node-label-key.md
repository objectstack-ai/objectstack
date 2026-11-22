---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/cli': minor
'@object-ui/i18n': minor
'@object-ui/components': patch
---

feat(spec): every step a flow drawing shows can be translated, under `flows.<flow>.nodes.<node_id>.label`

Clause-②: yes (widening: a new translation key `flows.<flow>.nodes.<node_id>.label`; the new exports `FLOW_TECHNICAL_NODE_TYPES` and `isFlowTechnicalNodeType` from `@objectstack/spec/automation`; and `@object-ui/i18n`'s exported `FlowLabelTranslations` type gains the member `screenTitle`, and its `stepLabel` parameter accepts a `config`)
Metadata-protocol: added
Skills-docs: follow-up #36401

A package can now translate the label of any flow step, not only a screen's heading and an approval step's label. A manual that embeds a flow (a `type: flow` metadata embed) lists its steps by label, and until now a start, decision, notify or end step had nowhere to put a translation, so a zh-CN reader saw those steps in English beside translated approval steps.

- **The key.** `flows.<flow>.nodes.<node_id>.label`, keyed by the node's `id`, at any depth. It overlays the node's own `label` and is plain text. A `screen` keeps its `screens.<node_id>.title` and an `approval` its `approvals.<node_id>.label`, so one string keeps one key: `objectstack validate` points a `nodes` key over either at that key, and points a `screens` or `approvals` key over any other node at `nodes.<node_id>.label`. A key over a node the flow does not declare is refused. `nodes` was an unknown-key hint that suggested `screens`; it is now its own group.
- **Start and end steps are translated like any other.** Their labels are the author's words and often name an outcome or a trigger ("Approved", "On Task Created"), so nothing substitutes words of its own for them.
- **Missing translations are reported.** `os lint` and `os i18n check` (`i18n/missing-flow`) now ask for the label of every top-level step the embed draws at its default `detail: business` altitude, except screens and approvals, which they already asked for, and of a folded technical step where a drawn decision's branch list names it as the step the branch leads to (a decision whose branch runs a `script` first). `os i18n extract` scaffolds the keys. An app that ships translated locales gets new findings for its flows until it translates them.
- **The drawings read it.** The docs viewer's `type: flow` embed (`element:metadata_viewer`) and the Studio flow designer's canvas, nested region nodes included, now name each step by its translation in the reader's language, through the one resolution in `@object-ui/i18n`: `stepLabel` reads `approvals.<node_id>.label` for an approval, `screens.<node_id>.title` for a screen with no `config.title`, and `nodes.<node_id>.label` for any other node. A step the package leaves untranslated keeps its authored label. A decision's branch list names the step a branch leads to the same way.
- **A titled screen is named by its heading in the docs embed.** A screen that authors its own `config.title` shows that heading at run time, translated under `screens.<node_id>.title`, so the embed names it by the heading (translated where the bundle carries it) instead of its canvas label, which has no key. A heading with a `{{ }}` hole cannot be filled in a drawing, so such a screen keeps its authored label. `FlowLabelTranslations` gains `screenTitle` for this read. The Studio canvas keeps a titled screen's authored label.
- **One table for what business altitude hides.** `FLOW_TECHNICAL_NODE_TYPES` (and `isFlowTechnicalNodeType`) in `@objectstack/spec/automation` lists the node types `detail: business` folds away (`script`, `http`, `connector_action`, `assignment`, `get_record`, `create_record`, `update_record`, `delete_record`, `boundary_event`). The docs viewer folds steps by it and the coverage check asks for translations by it, so they agree on which steps a reader sees.
