---
'@objectstack/skills': patch
---

docs(skills): the UI skill says where a form's column count is authored and where it is derived

Clause-②: no
Metadata-protocol: none

objectstack-ui `rules/navigation.md` "Record Presentation" said a form's column count is never authored. That holds for an object's own New, Edit and detail, which are built from the object's `fieldGroups` and never from a form view, and the section now says so. On a named or public form the count is authored per section, `{ group: 'contact_info', columns: 2 }` (1 to 4; one column on a phone), and the section now says that too, so an assistant asked for "two columns per group" no longer answers that it cannot be done. It also says a form view's own `columns` is not read by the form page today. The passage's rationale clauses are shortened to pay for the new words: the file stays at its token ceiling.
