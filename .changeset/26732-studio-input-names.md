---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's group-title, Description, Help text, nav "Link to object" and nav "Label" inputs have accessible names

Clause-②: no
Metadata-protocol: none

Five Studio inputs were anonymous to screen readers and automated accessibility checks. The form designer's inline group-title input is now named "Group name", the label the group inspector gives the same value. The field inspector's Description and Help text textareas, and the Interfaces nav-item inspector's "Link to object" picker and "Label" input, are now tied to the labels already drawn above them, so each is announced by its label and clicking the label focuses it. Nothing changes visually and nothing changes in what is saved.
