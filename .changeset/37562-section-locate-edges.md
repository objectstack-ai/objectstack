---
'@object-ui/app-shell': patch
---

fix(app-shell): a record opened at a cited section no longer marks a same-titled heading the outline does not list, and a heading that reads as nothing opens its field at once

Clause-②: no
Metadata-protocol: none

A record opened from a citation chip (`?section=ANCHOR`) finds the cited heading among the field's drawn headings that read the same, by count. When the body holds both a same-titled heading the outline does not list (a setext heading, one in a quote or a list item, a raw heading tag) and a listed heading the face does not draw (one inside a raw HTML block), the two counts agreed while the index pointed at the wrong heading. The body is now read for such headings as well, and when it holds one the field is opened instead of a heading that may be another section. A cited heading with no letter or digit, which no drawn heading can be matched to, now scrolls to its field as soon as the field is drawn, instead of after the four-second settle; a titled heading that is not drawn yet still waits for it.
