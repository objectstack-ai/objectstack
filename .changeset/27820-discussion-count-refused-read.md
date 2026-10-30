---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the discussion header shows no count when a feed read was refused

Clause-②: no
Metadata-protocol: none

A member who may not read a record's comments saw `Discussion (0)` directly above "You don't have permission to view comments on this record." The timeline's heading counted the rows it holds, and a refused read holds none, so the header claimed the record had no comments when the server only withheld them. When the host reports a refused comment or activity read, the timeline heading now shows its title with no count, and the collapsed discussion toggle reads "Open discussion panel" instead of `Show Discussion (0)`. A readable feed keeps its count, `(0)` included.
