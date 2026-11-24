---
'@objectstack/skills': patch
---

docs(skills): objectstack-i18n teaches the flow step-name key `flows.FLOW.nodes.NODE_ID.label`

Clause-②: no
Metadata-protocol: none

objectstack-i18n's SKILL.md, in the paragraph on the keys that sit deeper than their group's `label`, now names the flow step-name key `flows.FLOW.nodes.NODE_ID.label`: a screen is named through its heading `flows.FLOW.screens.NODE_ID.title` and takes a `nodes` key only beside a `title` of its own, `os i18n check` asks for a flow's top-level steps, and a step of one of the `FLOW_TECHNICAL_NODE_TYPES` (listed) is asked only where a decision's branch leads to it. Text only; paid inside the same file by cutting three restatements in the coverage and extract sections.
