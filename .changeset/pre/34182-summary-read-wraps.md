---
'@object-ui/plugin-detail': patch
'@object-ui/fields': patch
---

fix(plugin-detail): a long text summary roll-up wraps on the record page, and the summary's read display follows dark mode

Clause-②: no
Metadata-protocol: none

A summary (roll-up) field whose value is text read on the record page cut to one line with an ellipsis, the whole value only in a hover tooltip, as a formula did before. The record page's field rows now read a summary through the summary field's own read display, the face the record form draws, so the whole value shows and wraps. A number or money roll-up reads the same text it did.

That read display used a fixed grey text colour that stayed the same in dark mode. It now uses the theme's foreground colour, so a roll-up reads at full contrast in both themes.

What does not change: list and grid rows keep the one-line cell with the whole value in its tooltip, and the record page's highlights strip keeps its face. A host that registered its own `summary` face keeps it on the record page. No metadata key, value or default changes.
