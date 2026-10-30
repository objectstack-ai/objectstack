---
'@object-ui/react': patch
'@object-ui/components': patch
'@object-ui/console': patch
---

Clause-②: yes (widening: @object-ui/react gains the public export unmarkedRefusalLines; no accept set moves)
Metadata-protocol: none

A save refused by two or more validation rules now lists each rule's message on its own line in the form's banner and toast, instead of the server's `; `-joined summary. A rule that names a field the form draws keeps its message under that input, and the banner says only the rest. The refusal envelope is unchanged: the console reads the one `fields[]` entry per rule it already carried. `@object-ui/react` adds `unmarkedRefusalLines(err, isShownInline)`, which answers those lines (or `null` when the refusal has no entry list, so the caller keeps the envelope's message).
