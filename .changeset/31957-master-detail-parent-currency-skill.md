---
'@objectstack/skills': patch
---

docs(skills): the objectstack-data field-types rule teaches a line amount that follows its `master_detail` parent's currency

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/field-types.md` § Currency taught `currencyField` only as a sibling code field, so an author building an invoice with line items gave each line its own code. It now teaches the two-segment form `'<master_detail field>.<parent code field>'` with one invoice and line-item example: one hop through a `master_detail` (a `lookup` path is refused) to the parent's `iso_4217_currency` field; a blank parent code refuses the line amount (`ERR_CURRENCY_CODE_REQUIRED`) and the code backfill refuses a path; a `sum`/`min`/`max`/`avg` roll-up through that `master_detail` declares `currencyConfig: { currencyMode: 'record', currencyField: <parent code field> }`; and once a line follows, the parent's code cannot change (`VALIDATION_FAILED`, a first code over a blank one passes) until no line follows it. Growth is paid first by same-file deletions of restated text: the dataset-measure `currency` sentence (home: objectstack-ui § Dashboards) and the autonumber "Incorrect vs Correct" pair (home: § Autonumber rules 1 and 2).
