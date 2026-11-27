---
'@objectstack/skills': patch
---

docs(skills): the checked action examples no longer carry a `locations` key

Clause-②: no
Metadata-protocol: none

Seven examples drop their `locations` key: the Ask AI example in `skills/objectstack-ai/SKILL.md`, the "Mark as done" JSON in `skills/objectstack-ui/SKILL.md` (Actions), and five `defineAction` examples in `skills/objectstack-ui/rules/actions.md` (`crm_reassign_lead`, `crm_convert_lead`, `crm_print_a3`, `crm_open_invoice_pdf`, `crm_add_invoice_line`). Nothing an author can write changes, and the text around the examples is as it was: an action still draws only where its `locations` or a list view places it, so an action copied from one of these examples needs its `locations` added. Three token ceilings follow their files down to the measurement (6795 to 6787, 2264 to 2256, 3890 to 3844).
