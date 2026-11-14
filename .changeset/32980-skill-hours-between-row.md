---
'@objectstack/skills': patch
---

docs(skills): the formula skill's Want/Write table names the hours-between form

Clause-②: no
Metadata-protocol: none

`skills/objectstack-formula/SKILL.md` gains one row, "Hours between" → `double((datetime(record.end_at) - datetime(record.start_at)).getMinutes()) / 60.0`, beside `daysBetween` (whole days), and the date-arithmetic note names that form as the hours exception. It is the same form the date-subtraction refusals now name (#32980's fix); no authorable surface changes.
