---
'@objectstack/skills': patch
---

docs(skills): the published skills teach the action `locations` words of protocol 19

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ui/rules/actions.md`: the location table lists `list` (acts on no record: the list page toolbar), `record` (acts on one record, on the record page and on each list row; the default), `record_page` (the record page only), `record_row` (each list row only), `record_related` and `record_section`. One line under it names what replaced `list_toolbar`, `list_item`, `record_header` and `record_more`. The `actionLayout` paragraph says the `record` arm takes `record` / `record_page` actions and the `list` arm takes `list` actions.

The six examples that had dropped their `locations` key declare a placement again: `"locations": ["record"]` on the "Mark as done" JSON in `skills/objectstack-ui/SKILL.md`; `['record']` on `crm_reassign_lead`, `crm_convert_lead`, `crm_open_invoice_pdf` and `crm_add_invoice_line`; and `['record_page']` on `crm_print_a3`. This replaces the earlier note in this release, which said that an action copied from one of them needs its `locations` added.

`skills/objectstack-ui/rules/record-page.md` and `skills/objectstack-formula/SKILL.md` each change one sentence to the new words, and five eval cases under `skills/objectstack-ui/evals/` expect them. Nothing an author can write changes: these are the words `@objectstack/spec` 19 already accepts.

Token ceilings: `skills/objectstack-ui/rules/actions.md` 3844 to 3918, after one restating sentence was cut from it; `skills/objectstack-ui/SKILL.md` 2256 to 2253; `skills/objectstack-formula/SKILL.md` 6090 to 6088.
