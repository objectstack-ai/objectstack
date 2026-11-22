---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

The record-page skills teach the parent-declared record page:

- `objectstack-ui` record-page rule: the parent's `relatedLists` is the tab list. Without it nothing changes; declared, only the named lists show, in order, with the attachments, approvals and activity tabs named by object (`sys_attachment`, `sys_approval_request`, `sys_activity`), and an entry `{ list, label, columns }` titles one list. "Put the tasks tab first" lists every tab to keep, tasks first, because a list naming only the task hides the rest. A child list another package adds is hidden by a `relatedLists` that does not name it.
- The same rule's step 1 no longer teaches a stage bar or a key-field strip: the stage is the status tag beside the title, whose menu moves it, and `highlightFields` feed hover cards, pickers and related-list columns. A field group lists its own members in `fields`. The wide full page pins the details left beside the tabs, unless the details hold a child table or there is no other tab; the right summary rail and its switch are gone from the text, and the details column's dragged width joins the reader's own choices.
- A `master_detail` child is a tab by default (`objectstack-data` relationships rule, the record-page rule and an eval); a parent field group naming the child list places its table among the fields, written only when asked, and the list keeps its tab too unless a declared `relatedLists` leaves it out.
- `objectstack-data` field-groups example lists each group's members in `fields`; `objectstack-ui` navigation names `fieldGroups` alone.
- Evals: the tasks-first case now writes the full tab list; new cases remove the attachments tab, place a Tax ID field after Industry in its group's list, and put a quote's line items above its amount section.
