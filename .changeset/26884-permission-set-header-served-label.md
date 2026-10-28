---
'@object-ui/app-shell': patch
---

fix(app-shell): the permission-set editor's header names the set by its translated label

Clause-②: no
Metadata-protocol: none

Setup → Permission Sets lists a set by the label the server serves for the viewer's locale (销售代表 under zh-CN), but opening it showed the authored label in the header ("Sales Representative"). The editor builds its draft from the layered read, which carries the authored text; the published list it already reads is the localized one. The header, on the Setup page and in the Studio Access pillar, now shows the served label while the draft's label is the published one. It is display only: a save sends the authored label unchanged, a set that was never published keeps its draft label, and an edit to the label shows the edit.

What to do: nothing.
