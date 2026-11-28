---
'@object-ui/app-shell': patch
---

fix(app-shell): a cited section whose heading carries a link or an entity opens at that heading

Clause-②: no
Metadata-protocol: none

The record page finds a cited section (`?section=ANCHOR`) by reading the body outline's heading and the drawn heading the same way. The outline lists a markdown heading as its source line, so a heading with a link (`## [Terms](https://example.com) scope`) or an entity (`&copy;`) read differently from the text the face draws, and the page opened the field instead of the section. The page now reads each listed heading as its face draws it: a markdown heading through the face's own parse, found by where it starts, and an html heading with every entity decoded. Bold, inline code and escaped punctuation already matched and still do. The anchor and the outline are unchanged.
