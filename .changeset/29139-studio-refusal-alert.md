---
'@object-ui/app-shell': patch
---

fix(studio): a refusal shown in a Studio strip is announced to screen readers — its sentence is a `role="alert"`, as Setup › Packaged automation announced it

Clause-②: no
Metadata-protocol: none

Every Studio pillar shows a refused save, load, publish or flow switch in the same refusal strip, and the strip had no role and no live region, so a screen reader announced nothing: an author whose flow switch was refused heard silence while the switch simply did not move. The strip's sentence is now an alert, holding the sentence verbatim and nothing else. "Show me" and the Details disclosure stay outside it, so they are not read as part of the sentence, and opening Details does not announce it again. A second refusal of the same flip is announced again, because the strip leaves while the next request is in flight. Nothing visual changes.
