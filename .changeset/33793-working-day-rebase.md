---
'@objectstack/scenarios': patch
---

fix(scenarios): a card that keeps to working days stays on working days on every run date

Clause-②: no
Metadata-protocol: none

A scenario card can declare `workingDays: true`. The run-date rebase then moves its `asOf` onto the run
date and every other date by whole working days instead of whole days, so a Monday-to-Friday leave day,
and the weekday an ask names, stays on a working day however far from `asOf` the card runs (a weekend run
date moves them as for the Friday before it). The loader refuses such a card when it holds a weekend date
other than its `asOf`, or has no `asOf`. The `leave_balances` card declares it, so its request days,
balances and truths keep their meaning on every run date.
