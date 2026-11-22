---
'@object-ui/components': patch
'@object-ui/i18n': patch
---

fix(components): a docs `type: flow` metadata embed names the flow and its approval steps in the reader's language

Clause-②: no
Metadata-protocol: none

A package can translate a flow's label (`flows.<flow>.label`) and an approval step's label (`flows.<flow>.approvals.<node_id>.label`). The flow runner and the Studio flow designer already showed both, but the docs viewer's `type: flow` embed (`element:metadata_viewer`) drew the authored text, so a zh-CN reader of a manual saw the English flow name and step names. The embed now reads the same bundle, through the same resolution, in the reader's language, and falls back to the authored text where the bundle carries no key. A decision's branch list names the approval step a branch leads to by the same translated label.

The spec has no key yet for a start, decision, notify or end node's label, so those steps still show the authored text.

`@object-ui/i18n` now also exports the flow-label resolution (`flowLabelTranslations`, `useFlowLabelTranslations` and the `FlowLabelTranslations` type), moved out of the Studio flow designer and built on the `activeFlowsBundle` reader that package already exports, so the runner, the designer and the docs viewer share one reader of the `flows` group.
