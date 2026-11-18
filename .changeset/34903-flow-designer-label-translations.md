---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the Studio flow designer shows a package's translated flow label and approval-step labels

Clause-②: yes
Metadata-protocol: none

A package can translate a flow's label (`flows.<flow>.label`) and an approval step's label (`flows.<flow>.approvals.<node_id>.label`). The flow runner already used both. The Studio flow designer ignored them, so a zh-CN admin saw the authored English flow name and step names. The designer now reads the same bundle the runner reads, through the spec's `translateFlow`, in the viewer's language. The automation header names the flow by its translation. Approval nodes show their translated step label on the canvas (nested ones included) and in the inspector header. The inspector also shows the authored label on a second line ("Authored label: …"), because Studio is where that label is edited. With no translation, every label shows as authored, as before. The draft is never rewritten with a translation.

The spec has no key for a decision or other node's label, or for an edge label, so those still show the authored text.

`@object-ui/i18n` gains one lazy `studio`-namespace key, `engine.inspector.flowNode.sourceLabel` (en and zh). The eager `locales/en.ts` pack is unchanged.
