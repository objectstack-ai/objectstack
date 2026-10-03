---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the object door lists a stored view row under its own name even where a stored view container expands that name, as the by-name read already answers

Clause-②: no

- **What changed.** `GET /api/v1/meta/view?object=…` (the object door) no longer lets a stored view container's expansion replace a stored row of the same name. A view item (a row carrying `viewKind`) saved under a name the container also expands, such as `<object>.default` beside a stored overlay of that object's container, is now what the object door lists under that name. Before, the object door listed the container's expansion there while the by-name read (`GET /api/v1/meta/view/NAME`) answered the stored row. Both doors now answer the row.
- **The rule.** A row stored under exactly a name is the override for that name (ADR-0005 keys an overlay by its own name). An expansion fills only the names that have no row of their own. The list read and the by-name read decide this with one test, over the rows each selects for the same caller, so a row stored for one organization does not hide the expansion from any other caller.
- **A container stored under one of its own expanded names.** That row is the name's own row as well, so its expansion no longer fills the name. The object door never lists a container, so it now lists nothing under that name. Before, it listed the container's expansion there. The by-name read answers the stored container, as before.
- **What does not change.** Every name a container expands that has no stored row of its own is still listed, and on both doors it still replaces a packaged view of the same name. The by-name read answers as before. The save door is unchanged. No response shape gains or loses a key.
