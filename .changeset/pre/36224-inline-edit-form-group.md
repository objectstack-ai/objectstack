---
'@objectstack/skills': patch
---

docs(skills): entering line items in the parent's form is taught as a parent field group naming the child, not `inlineEdit` alone

Clause-②: no
Metadata-protocol: none

objectstack-data's `rules/relationships.md` (Inline Editing), objectstack-ui's `rules/list-views.md` (Master-Detail Forms) and the objectstack-ui `SKILL.md` trap list taught that `inlineEdit: true` on the child's `master_detail` field puts the child grid into the parent's form. They now teach the rule the platform applies: the parent's form enters a child's rows where a field group of the parent names that child (`fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'invoice_line' }]`), `inlineEdit` only picks how those rows are edited, and without the group the child is a tab and the form has no lines. Text only; each file's old wording is cut to pay for the new. Two eval cases that expected the old answer are corrected and objectstack-data gains one case for form entry of quote lines.
