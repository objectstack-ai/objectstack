---
"@object-ui/plugin-detail": minor
"@object-ui/types": patch
---

Clause-②: no
Metadata-protocol: semantic

A record section whose fields are all empty, and that the page keeps (`hideEmpty: false`), now draws its heading plus one "Show N empty fields" row in read-only mode, the same fold a partly-filled section uses, instead of a placeholder row per field. Edit mode still draws every field as an editable row, and a print page still prints every row. When every section of a detail body is empty and at least two are kept, the body draws one "Show N empty fields" row for all of them (objectui#13386, objectui#12618).
