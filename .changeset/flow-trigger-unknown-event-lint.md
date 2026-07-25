---
"@objectstack/lint": minor
---

feat(lint): flag never-firing record trigger tokens at authoring time (#3427)

New `flow-trigger-unknown-event` rule in `validateFlowTriggerReadiness`: a flow
start node whose `triggerType` is record-lifecycle-shaped
(`record-before|after-<op>`) but names an op the record-change trigger cannot map
— e.g. a typo like `record-after-updated` — binds to the record-change trigger
yet maps to no ObjectQL hook and never fires, with only a runtime warning. The
rule surfaces that never-fire defect at `os validate` time. Warning severity;
bare `record-<noun>` shapes (e.g. `record-change`) are out of scope.
