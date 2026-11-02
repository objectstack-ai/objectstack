---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record history badge shows the action's option label, not the stored word upper-cased

Clause-②: yes (widening)
Metadata-protocol: none

A record's history tab printed each entry's stored action value in an upper-cased badge. A zh reader saw `UPDATED` and `CREATED` beside a Chinese summary, although the option's zh label was already served.

What changes:

- `HistoryTimeline` takes an optional `actionField` prop, `{ object, field }` (its type, `HistoryActionField`, is exported from the package entry), that names the select field its entries' `action` values come from. Each badge then shows that option's label in the active language, read through `useSafeFieldLabel().fieldOptionLabel` like any select option label on the record page.
- `record:history` names `sys_activity.type` for the entries it fetches itself, so in zh its badges read 已更新 and 已创建.
- A value with no label, and every value when no field is named (entries a host passes in, for example), shows as stored. Only a value shown as stored is upper-cased, so the English badges look the same as before.

What to do: nothing. No metadata a page, view or object declares changes.
