---
'@object-ui/app-shell': patch
---

fix(app-shell): a record opened at a cited section no longer marks a same-titled heading the outline does not list, and opens its field at once when no heading can be told apart

Clause-②: no
Metadata-protocol: none

A record opened from a citation chip (`?section=ANCHOR`) finds the cited heading among the field's drawn headings that read the same, by count. When the body draws both a same-titled heading the outline does not list (a setext heading, one in a quote, a list item or a footnote, the footnote section's label) and a listed heading the face does not draw (one inside a raw HTML block), the two counts agreed while the index pointed at the wrong heading. A markdown body's unlisted headings are now counted from the field's own parse (`@object-ui/fields`' `loadDrawnMarkdownHeadings`, loaded on demand), so they are the headings the face draws; an html body's from its heading tags. When the body draws one, the field is opened instead of a heading that may be another section. That field, like the field of a cited heading with no letter or digit, is now scrolled to as soon as it is drawn instead of after the four-second settle; a titled heading that is not drawn yet still waits for it.
