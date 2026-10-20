---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec): the `flows` translation face gains `approvals.<node_id>.label`, the step label of an `approval` node

Clause-②: yes (widening)

- **Before.** `TranslationDataSchema.flows.<flow>` carried `label`, `successMessage`, `errorMessage`, `screens.<node_id>` (screen nodes) and `refusals.<node_id>` (refusing `end` nodes), and nothing for an `approval` node. A language pack had nowhere to put an approval step's name: `approvals` was refused as an unknown key, and a `screens.<node_id>.title` key over an approval node was refused `translation-target-unknown` by `objectstack validate`, because the node is not a screen.
- **Now.** `flows.<flow>.approvals.<node_id>.label` is a declared key, addressed by the `approval` node's `id` (at any depth, regions included) and overlaying that node's own `label`, the step name an approval request shows. The entry is closed: `title`, `name`, `heading` and `stepLabel` are named as renames onto `label`, and `approval` as the rename onto the `approvals` group.
- **`objectstack validate`.** `@objectstack/lint`'s translation-reference check accepts the key over an `approval` node and refuses it, as `translation-target-unknown`, over an unknown node or a node of another type (a `screen` node is pointed at its `screens.<node_id>.title`). A `screens` or `refusals` key written over an approval node is now pointed at `approvals.<node_id>.label` instead of being told only that the node is not a screen.
- **Not yet rendered.** This is the spec half: the key parses and validates, and the approvals service does not read it yet, so an approval request still shows the authored step label. Its liveness row is `planned` until that reader lands.
- **Unchanged.** Every existing `flows` key, and every verdict on a key over a node that is not an approval node.
