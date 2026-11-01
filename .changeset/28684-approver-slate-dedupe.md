---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): an approver that resolves the same person twice opens one slot for them, so one signature counts once (#28684)

Clause-②: no
Metadata-protocol: none

An approval step builds its slate one approver entry at a time, and an entry could name the same person more than once. An `expression` approver yielding `['u2', 'u2']` (for example a lead picking the same reviewer twice for the next step), a `field` approver holding `'u2,u2'`, two ids whose out-of-office delegation routes to the same delegate, or a `resolveAs` expression returning two departments that share a member each opened a slot per occurrence. The request then listed that person twice as pending, and under `behavior: 'per_group'` their one approval counted twice toward `minApprovals`, so a group could finalize on a single signature.

Now each approver entry names each resolved person once, after out-of-office delegation, in first-appearance order. Every group the person resolved into is still recorded, and a person tagged into the same group twice (also when two approver entries name them under one group) counts once in that group's tally. Two approver entries that both name one person still give one slot per entry, as before.
