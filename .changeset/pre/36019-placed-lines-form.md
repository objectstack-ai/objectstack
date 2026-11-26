---
'@object-ui/plugin-form': patch
'@object-ui/components': patch
---

fix(ui): a placed line table's row editor is a form of its own, and a refused line marks its tab

Clause-②: no
Metadata-protocol: none

Two fixes to a master-detail entry form whose field group places the line table:

- Opening a line's row editor no longer draws the editor's form inside the placed table's wrapper form. The markup is valid again, and React no longer logs "form cannot be a descendant of form" in development. The editor's inputs still belong to the editor's own form.
- In a tabbed form, a save the server refuses on a line marks the tab that holds the lines, the way a refused header field marks its own tab. A refusal is on the lines when the server names a line's operation as the failed one, or names a field that only the lines write. The mark clears when the next save gets past validation.
