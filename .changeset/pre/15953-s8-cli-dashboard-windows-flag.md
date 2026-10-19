---
'@objectstack/cli': patch
---

fix(cli): `os verify --dashboard-windows` describes the measures it proves: counts, sums and derived measures

Clause-②: no (the flag, its default and what it accepts are unchanged; only its help text moves)

The `--dashboard-windows` flag description ended "(date and datetime fields; count measures)". The date-window family in `@objectstack/verify` now also proves sums and derived measures over counts or sums, so it reads FROM "(date and datetime fields; count measures)" TO "(date and datetime fields; count, sum and derived measures)". Nothing else about the flag changes.
