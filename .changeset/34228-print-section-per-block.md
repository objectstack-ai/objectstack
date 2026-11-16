---
'@objectstack/skills': patch
---

docs(ui, skills): a print page whose sections may break between sheets authors one `record:details` block per section

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ui/rules/pages.md`, § Print pages: one sentence after the page-break hints says that where sections may break between sheets, the author writes one `record:details` block per section, because `avoidBreakInside` keeps each block whole and a multi-section block moves to the next sheet whole. The file pays for it within its token ceiling by dropping the sentence that said the console's print rendering was still to follow and that `os validate` warns the layout is not applied, which no longer holds: the console applies every `print` key. The docs page `content/docs/ui/print-pages.mdx` carries the same guidance under its key table. `avoidBreakInside` keeps its meaning; no schema or runtime change.
