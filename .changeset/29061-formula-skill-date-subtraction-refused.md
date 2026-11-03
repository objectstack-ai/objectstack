---
'@objectstack/skills': patch
---

docs(skills): objectstack-formula says the build refuses date subtraction (`end - start`), and the skills stop describing a stored formula that subtracts dates

Clause-②: no
Metadata-protocol: none

- **Before.** The "No date arithmetic" note in `objectstack-formula` said `end - start` "does not fault — it yields a `duration` stored as `{}`", which read as a shape that builds. `objectstack-ui` `rules/dashboards.md` and an analytics eval described a leave-days formula written as `end - start`, and a formula eval explained `record.close_date - today()` as "a duration stored as `{}`".
- **Now.** The note says the build refuses both `date + n` and `end - start`: a date or date-time mixed with a number, or minus another, reads `null`, and `today()` / `now()` minus a date field reads `{}`. It prescribes `daysBetween(a, b)` and keeps the Want / Write table. The leave-days formula is written `daysBetween(start, end)` in the dashboards rule and `daysBetween(record.start_date, record.end_date)` in the eval prompt, and the formula eval says the build refuses `record.close_date - today()`.
- The formula gate change itself ships in `@objectstack/formula` (`formula-date-subtraction-refused`). `SKILL.md` and `rules/dashboards.md` stay under their token ceilings (no ceiling moves). No schema, key, command or behaviour changes.
