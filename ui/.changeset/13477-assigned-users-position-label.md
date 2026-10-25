---
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

A permission set's Assigned users list now names the position a person holds the set through by the position's label, in the viewer's language, instead of its machine name (objectui#13477).

The "via position" chip drew the `position` column of the holder's `sys_user_position` row, the machine name, although the section had already listed the registry's position definitions to find the positions that distribute the set, and that list carries each definition's label as the server localizes it. The chip now reads the label from that list and keeps the name on its tooltip, as the access explainer's position chips do. A position whose definition has no label still reads by its name.
