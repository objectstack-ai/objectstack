---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

A `date` or `datetime` field can declare that it is a deadline, and when that deadline is settled: `dueLike` and `settledWhen`

Clause-②: yes

- **`dueLike: boolean`** (optional, no default) declares the date a deadline. A renderer may then show relative overdue wording and an overdue colour once the date has passed. Absent means not a deadline: nothing is inferred from the field's name.
- **`settledWhen`** (optional) is a per-record CEL predicate in the `visibleWhen` / `readonlyWhen` / `requiredWhen` family. While it holds, the deadline is settled and no overdue wording or colour applies to that record, for example `record.status == 'done'`.
- **The doors that judge them.** `FieldSchema` refuses either key on any type other than `date` / `datetime`, and refuses `settledWhen` unless the field also declares `dueLike: true`. The CEL is judged by `@objectstack/lint`'s field-rule pass, the one `visibleWhen` goes through, at `objectstack build`, `objectstack validate` and the object save: it must parse, read fields as `record.<field>`, name declared fields, and read no root but `record` (plus `previous`, and `parent` on a master-detail line item).
- **Display only.** Nothing on the write path reads either key. Every metadata that parsed before parses unchanged; a field without the keys behaves exactly as before.
- **Who reads them.** objectui's date and datetime cells read `dueLike` on the record detail surfaces today. Reading `settledWhen`, and retiring the field-name guess, follows in objectui once this spec version is published.
- **Where to author them.** The field designer offers both on date and datetime fields, `settledWhen` only once the field is a deadline. The example apps declare them on the showcase and todo `task` and the CRM `activity`.
