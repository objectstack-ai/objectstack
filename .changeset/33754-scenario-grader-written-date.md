---
'@objectstack/scenarios': patch
---

fix(scenarios): the run grader reads a written calendar date ("31 Dec") as no figure

Clause-②: no
Metadata-protocol: none

An unanswerable question passes when the agent declines and every number it writes is carried by a tool output of the turn. The number reader skipped ISO dates only, so a decline that offered to list laptops "whose 36-month depreciation life ends by 31 Dec" read `31` as a figure no output carried, and a correct reply failed with "stated a figure the data cannot support".

The reader now skips a written calendar date the way it skips an ISO date: a day and a month name in either order (`31 Dec`, `Dec 31, 2026`), a month name with its year (`December 2026`), a slash date with its year (`31/12/2026`), and a Chinese date (`12月31日`, `2026年12月`). A month name is read only capitalised, a slash pair with no year (`3/4`) stays a figure, and a number beside no month is still read, so an invented count or amount ("about 12 laptops", "$4,200 due by 31 Dec") still fails.
