---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

The platform catalog (`objectstack-project/references/platform-catalog.md`) now lists units of measure as shipped. `sys_unit` has a row beside `sys_exchange_rate`, and the row names the declaration that uses it: `unitConfig` on a `number` field (`unitMode: 'fixed'` with `unit`, or `'record'` with `unitField`) or on a `text` field that holds a unit code (`unitMode: 'code'`). A stored code is a standard UN/ECE Rec 20 code or one of the organization's own units, added in Setup, so an app no longer builds a unit table or a unit picklist. The Planned row narrows to what is still missing: showing the unit beside a quantity, totals per unit and conversion. The page no longer describes an interim unit field, and `objectstack-data` eval 22 expects the shipped answer.
