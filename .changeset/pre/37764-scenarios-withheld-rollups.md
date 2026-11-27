---
'@objectstack/scenarios': patch
---

feat(scenarios): a scenario card may name the roll-ups a persona is denied, and the build prompt says so

Clause-②: no
Metadata-protocol: none

A persona on a scenario card may now carry `withheldRollups` (`[{ "object": "project", "field": "task_count" }]`, in the card's bare names): the roll-ups on objects the persona reads that summarise rows or fields its `hidden` withholds. The build prompt's line for that persona names them and says they are withheld too, so a build no longer has to guess that a person who may not see the rows may not see their total either. The Build charge for `security-rollup-source-unreadable` is unchanged, and the leak grader does not read the key. The schema refuses a withheld roll-up the persona's `hidden` already names or its `allowedRollups` allows; the loader refuses one on a field no seed row carries. `project_with_tasks` withholds the task count and total estimate from the client viewer, and `invoice_with_line_items` withholds the invoice total from warehouse staff; every other card's prompts are unchanged.
