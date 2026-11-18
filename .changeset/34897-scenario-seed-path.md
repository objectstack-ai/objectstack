---
'@objectstack/scenarios': patch
---

fix(scenarios): the runner loads a card's seed through the platform's seed path, so a build's status state machine no longer refuses rows the card states as already past their entry state

Clause-②: no
Metadata-protocol: none

The runner wrote every seed row through the data API as the admin. That is a user write, so a build's `state_machine` rule judged each one: a build that declared `initialStates: ['draft']` on a claim's status, as the data skill teaches, refused every claim the card states as `paid`, `submitted` or `rejected`, and every line and approval step under them failed for want of its claim. On `travel_expense` that was 114 root refusals and 470 cascaded ones, 584 of 757 rows.

The seed now goes in as one data-only package whose `data[]` holds the card's rows, installed through the managed install door. The platform's seed loader writes them as established facts: it skips the `state_machine` rule only, so every other validation rule and every hook still judges each row. Each row keeps the card's own `id`, a lookup value names the row seeded under it, and a user id in `owner_id` or a `user` field lands as sent. A refused row is still recorded with its object, id and the loader's message; the seed door names no error code. A restore puts a removed seeded row back the same way. The second pass, which sets the lookups that close a reference cycle, is unchanged.

Seed rows no longer fire a build's record-triggered flows, as the data API's insert did. No library card relies on that: every truth is computed from the seed's own values, and the cards that ask for such flows seed the values a flow would produce.
