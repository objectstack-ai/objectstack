---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): an out-of-office delegation with an inverted window or the delegator as their own delegate is refused at the write, naming the field

Clause-②: yes (narrowing) — narrowed: a `sys_approval_delegation` insert, or an update that moves the compared columns, answers `400 VALIDATION_FAILED` where it was stored, when `valid_until` is at or before `valid_from` (field `valid_until`, rule `validity_window_order`) or when `delegate_id` equals `delegator_id` (field `delegate_id`, rule `delegate_not_delegator`). Both shapes were stored and never rerouted an approval. Nothing widens.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches out-of-office delegation; `content/docs/automation/approvals.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: the change is two declared validation rules on a platform object's data rows. A row stored with either shape before them was already inert and stays inert, so there is nothing for a migration to rewrite. -->

An out-of-office delegation whose window ends at or before it starts, or whose delegate is the delegator, could never reroute an approval, yet the write answered `201` and the delegator believed their approvals were covered. Both are now refused with `400 VALIDATION_FAILED` and a message on the field to correct.

Unchanged: a valid window with a different delegate; an open-ended window (either bound empty, or both); and an update that moves neither compared column, so a row stored with either shape before this release still takes unrelated edits.

What to do: nothing for a valid delegation. A row stored with an inverted window or a self-delegate stays inert as before: correct its dates or its delegate, or delete it.
