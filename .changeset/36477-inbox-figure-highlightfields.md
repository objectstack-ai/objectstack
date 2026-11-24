---
'@object-ui/console': patch
---

fix(console): the approvals inbox row figure is the field the object declares, not a guess from field names

Clause-②: no
Metadata-protocol: none

Each request row in the console's approvals inbox shows a figure after the object name, and the inbox's "Amount (high→low)" sort orders on it. That figure is now the first `highlightFields` entry of the request's object (ADR-0085: the object's one curated list of its most important fields, first entry wins where only one fits) that names a numeric field — `number`, `currency`, `percent`, `summary`, or a `formula` whose `returnType` is `number`, `currency` or `percent` — and that the object does not declare `hidden: true`. The value comes from the request's submitted snapshot, formatted as before.

Before, the console picked the first snapshot key whose NAME looked like money (`amount`, `total`, `fee`, `budget`, …) with a non-zero value, so an incidental money-named field declared before the headline figure was shown instead of it, and an app could not change the choice without renaming or reordering its fields.

Visible change: an object whose `highlightFields` names no numeric field (or that declares no `highlightFields`) no longer shows a figure on its inbox rows, and those rows sink to the bottom of the amount sort. To show one, list the headline numeric field in the object's `highlightFields`. A declared figure of 0 is now shown (the old guess skipped zeros). The figure is read from the same per-object metadata read the inbox already made, so no request is added.
