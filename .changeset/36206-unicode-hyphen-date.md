---
'@objectstack/scenarios': patch
---

fix(scenarios): an ISO date written with a Unicode hyphen states no figure

Clause-②: no
Metadata-protocol: none

The run grader skips the parts of an ISO date when it reads the figures a reply states, but it matched only the ASCII `-`. A reply that wrote a date with the non-breaking hyphen U+2011 (or the hyphen U+2010), as a typeset answer does, had its year, month and day read as three figures, so a correct decline was graded "stated a figure the data cannot support". Such a date is now read as a date; a figure range joined by the same hyphen still reads as figures.
