---
'@objectstack/scenarios': patch
---

fix(scenarios): a card's dates move onto the day it runs, so its "today" agrees with the app's real clock

Clause-②: no
Metadata-protocol: none

A card fixes its "today" (`asOf`) and every prompt states it, but the app the run boots stamps `created_at` and `updated_at` with the real clock. A run weeks after `asOf` showed the agent seeded rows "created" after the day it was told was today. Agents stopped to ask about the mismatch, and correct operations failed.

Before each card runs, `run-scenarios` now moves the card's dates by one whole-day delta, `run date − asOf`. The delta applies to `asOf`, every ISO date under `run` and `iterate` (seed rows, truth filters, operation values and expected post-states), and the dates an operation's or question's `ask` writes in its text (ISO dates, English `[Weekday] D Month`, Chinese `M 月 D 日(周X)`, with weekday names written again). The truths are computed again over the moved seed, so the prompt's "today", the seeded rows, the record timestamps and the grader's expectations agree. Intervals between the card's dates are kept exactly. A `calendar` window (`this_month`, `previous_month`) is read around the moved today. The card files are not changed, and a card without `asOf` runs as before.
