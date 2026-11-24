---
'@objectstack/plugin-approvals': patch
---

fix(approvals): the no-approver note names its position by its label

Clause-②: no
Metadata-protocol: none

When a request opens with no one able to approve it and its approver list names an unstaffed position, its timeline note told the reader to add "a member who holds position 'regional_manager'", with the position's internal name, in every language. The note now stores the position as a reference, so a reader is served the position's label the way the administrators' routing note names one: the reader's language pack (`positions.<name>.label`) first, else the position's declared `label`, else the name as before. The English the row stores for audit keeps the name, and a note written before this change is shown exactly as it was.
