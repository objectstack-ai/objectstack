---
'@objectstack/formula': patch
---

fix(formula): the date-subtraction refusals name the sub-day form next to `daysBetween`

Clause-②: no
Metadata-protocol: none

The `date-text-arithmetic` refusal (and its flow and fail-closed / fail-open arms) and the `date-duration-value` refusal sent an author who wanted an hour span, such as overtime hours from two date-time fields, to `daysBetween(a, b)`, which counts whole days only. Both refusals now add: for a span in hours or minutes, wrap each side in `datetime(…)` and read the Duration, `(datetime(b) - datetime(a)).getMinutes()` / `.getHours()`. That form already validated and evaluated; only the refusal wording changes, and the refusal codes and params are unchanged.

FROM `record.end_at - record.start_at` (refused, `date-text-arithmetic`) TO `double((datetime(record.end_at) - datetime(record.start_at)).getMinutes()) / 60.0` for the hours between them.
