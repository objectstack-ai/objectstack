---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a record page's empty-sections line follows the reader's remembered "show empty fields" choice

Clause-②: no
Metadata-protocol: none

A reader who chose "show empty fields" for an object found the record page's closing empty-sections line ("Deal Narrative · Notes & Next Steps · 2 empty sections · Expand") folded again on every visit, on the default record page and on an authored one alike, and expanding the line was forgotten as soon as the page closed.

The line now reads and writes the same remembered choice each section's own "Show N empty fields" row already uses, kept per user and object. With "show empty fields" remembered, the line opens on its own, on both page kinds. Expanding or collapsing the line is that choice: it is remembered for every record of the object, after a reload and on another device, and it also opens or folds each section's own empty fields, since it is one choice.

What does not change: with no signed-in user or no host preference store, the line keeps its own state, forgotten when the page closes, as before. Edit mode and a print page still draw every section. No metadata key, value or default changes.
