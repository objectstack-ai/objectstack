---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): a long flow-node help opens clamped behind "Learn more", and a list column's description is shown under the column instead of filling its placeholder

Clause-②: no
Metadata-protocol: none

In Studio's flow node inspector:

- **Long help.** A field's help longer than 120 characters opens clamped to two lines with a **Learn more** toggle (**Show less** to fold it again). Shorter help renders in full as before. The whole text stays on the page either way, so a screen reader and a text search still reach it.
- **List column descriptions.** In a repeated list such as an approval node's Approvers, a column's schema description used to fill the input's placeholder, where a paragraph read as a cut-off example value and disappeared on the first keystroke. It is now the column's help, shown under the column with the same Learn more toggle, and the input keeps its own placeholder.

The words themselves are unchanged: they are the engine-published schema descriptions.
