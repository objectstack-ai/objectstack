---
'@object-ui/app-shell': patch
---

fix(app-shell): a dashboard draft the server refuses to read stays unopened in Studio Interfaces, whatever order the designers load in

Clause-②: no
Metadata-protocol: none

Studio Interfaces already opened no buffer over a pending draft whose read the server refuses (403: its `requiredPermissions` name a capability the author does not hold). That held only when the dashboard designer was registered before the pillar first rendered. The built-in designers load through a dynamic import, so on most fresh loads (and on the "All metadata" item link, which lands on the same pillar) the first render found no designer and stamped an empty buffer as the leaf's. When the designer arrived, the refusal kept that stamp: the canvas, the Properties inspector and the item tools opened on an empty body, and a Source edit was autosaved over the draft with no version pin, dropping its audience gate and every draft-only change. A reload of a leaf whose earlier read was answered kept its loaded buffer the same way.

A refused read now takes the leaf's buffer back, as the object, flow and app loads already do: nothing is shown to edit, and the autosave has nothing to send.
