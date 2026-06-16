---
"@objectstack/cli": minor
---

feat(cli): lint date-EQUALITY against time values in flow query filters (#1874)

The flow anti-pattern lint already flagged a record-change trigger CONDITION
using date equality (`end_date == daysFromNow(60)`). It now also scans
get_record/query node FILTERS for the same footgun: a field bound directly, or
via `$eq` / `$in`, to a time-function value (`daysFromNow`/`today`/`now`/…).
A `Field.date` is stored with a time component, so an exact match against a
re-computed timestamp silently returns nothing — the failure the templates
discrete-tier alerts hit. Range operators (`$gte`/`$lt` day windows) are the
correct shape and are never flagged. Advisory warning; never fails the build.
