---
"@objectstack/formula": minor
---

feat(formula): `isoDate(t)` and `isoDatetime(t)`, the string form of a CEL timestamp

Clause-②: yes (widening)

- **What is new.** Two CEL stdlib functions that turn a timestamp into ISO text on the UTC calendar. `isoDate(t)` returns `YYYY-MM-DD` and `isoDatetime(t)` returns `YYYY-MM-DDTHH:mm:ss.sssZ`, always with three-digit milliseconds and a `Z`. Both are in `CEL_STDLIB_FUNCTIONS`, so `introspectScope` advertises them and the build check accepts them.
- **The bytes the flow template dialect wrote.** `isoDate(today())` is the text `{TODAY()}` wrote, `isoDatetime(now())` is the text `{NOW()}` wrote, and `isoDate(daysFromNow(n))` / `isoDate(daysAgo(n))` are the text `{TODAY() + n}` / `{TODAY() - n}` wrote, in a flow value envelope. This holds at month, year, leap-day and DST-transition instants, whatever the host's zone.
- **`isoDate(today())` is the reference-timezone day.** `today()` is that day at UTC midnight, and `isoDate` reads the UTC calendar. Under a non-UTC reference zone, `isoDate(now())` can be a different day: it is the UTC day of the instant.
- **Only a timestamp is accepted.** Text, a number or `null` is refused, at build when the argument's type is known and at run otherwise. It is never coerced or rendered. For ISO text, parse it first: `isoDate(date(s))`. An invalid timestamp, or one outside 0001-01-01 to 9999-12-31, is refused at run.
- **`string(timestamp)` is still refused.** CEL defines that conversion as RFC 3339 text that drops a zero fraction, which is not the template's `.000Z`, so each shape has one spelling.
- **No write path changes.** An envelope that returns a timestamp (`today()`, `now()`, `daysFromNow(n)`, `addDays(…)`) still evaluates to a `Date` and writes what it wrote before.
