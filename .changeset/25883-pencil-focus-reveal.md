---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record page's inline-edit pencil shows on keyboard focus, not only on hover

Clause-②: no
Metadata-protocol: none

In read mode, the pencil beside an editable field (in the details body and in the highlights strip) was transparent until the pointer hovered its field. The pencil is a real button, so a keyboard user tabbing through the record landed on a control they could not see, focus ring included. It now also shows while it has keyboard focus, or while anything else in its field does. Hover, the row's hint and double-click to edit are unchanged.

What to do: nothing.
