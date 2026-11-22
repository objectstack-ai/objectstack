---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/cli': minor
---

feat(spec): every step a flow drawing shows can be translated, under `flows.<flow>.nodes.<node_id>.label`

Clause-②: yes (widening: a new translation key `flows.<flow>.nodes.<node_id>.label`, and the new exports `FLOW_TECHNICAL_NODE_TYPES` and `isFlowTechnicalNodeType` from `@objectstack/spec/automation`)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-i18n/SKILL.md

A package can now translate the label of any flow step, not only a screen's heading and an approval step's label. A manual that embeds a flow (a `type: flow` metadata embed) lists its steps by label, and until now a start, decision, notify or end step had nowhere to put a translation, so a zh-CN reader saw those steps in English beside translated approval steps.

- **The key.** `flows.<flow>.nodes.<node_id>.label`, keyed by the node's `id`, at any depth. It overlays the node's own `label` and is plain text. A `screen` keeps its `screens.<node_id>.title` and an `approval` its `approvals.<node_id>.label`, so one string keeps one key: `objectstack validate` points a `nodes` key over either at that key, and points a `screens` or `approvals` key over any other node at `nodes.<node_id>.label`. A key over a node the flow does not declare is refused. `nodes` was an unknown-key hint that suggested `screens`; it is now its own group.
- **Start and end steps are translated like any other.** Their labels are the author's words and often name an outcome or a trigger ("Approved", "On Task Created"), so nothing substitutes words of its own for them.
- **Missing translations are reported.** `os lint` and `os i18n check` (`i18n/missing-flow`) now ask for the label of every top-level step the embed draws at its default `detail: business` altitude, except screens and approvals, which they already asked for. `os i18n extract` scaffolds the keys. An app that ships translated locales gets new findings for its flows until it translates them.
- **One table for what business altitude hides.** `FLOW_TECHNICAL_NODE_TYPES` (and `isFlowTechnicalNodeType`) in `@objectstack/spec/automation` lists the node types `detail: business` folds away (`script`, `http`, `connector_action`, `assignment`, `get_record`, `create_record`, `update_record`, `delete_record`, `boundary_event`). The docs viewer and the coverage check read it, so they agree on which steps a reader sees.
