---
'@object-ui/app-shell': patch
---

fix(app-shell): the Studio Automations list names each flow by the package's translated label

Clause-②: no
Metadata-protocol: none

A package can translate a flow's label (`flows.<flow>.label`). The flow designer already showed that translation for the open flow, but the Automations list beside it still showed every flow by its authored English label, so a zh-CN admin looked for a flow under a name the list did not use. Each list row, and its hover title, now shows the same translated label the designer header shows, read through the same helper in the viewer's language. A flow the package does not translate keeps its authored label, as before. The list search matches the label a row shows, and still matches the authored label and the machine name.
