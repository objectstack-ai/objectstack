---
'@objectstack/skills': patch
---

docs(ui, skills): a print page whose sections may break between sheets authors one `record:details` block per section

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ui/rules/pages.md`, § Print pages: one sentence after the page-break hints says that where sections may break between sheets, the author writes one `record:details` block per section, because `avoidBreakInside` keeps each block whole on one sheet when it fits (the qualifier the spec describe carries: a block taller than one sheet still breaks inside itself) and a multi-section block moves to the next sheet whole. The file pays for it within its token ceiling, which is not raised. It drops the sentence that said the console's print rendering was still to follow and that `os validate` warns the layout is not applied, which no longer holds: the console applies every `print` key. It also drops the words ", in full" from "must draw all it declares", which they only repeated; the "draws a window of its rows" refusal still covers a block that draws part of its rows. And § Routing model drops "regardless of which app you came from" after "one global `/docs/<name>` route resolves any doc": the same paragraph already says the viewer is platform-level and the URL has no package or app prefix. The docs page `content/docs/ui/print-pages.mdx` carries the same guidance under its key table. `avoidBreakInside` keeps its meaning; no schema or runtime change.
