---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": minor
---

feat(approvals,spec): structured reassign hand-off parties on `sys_approval_action` (#4365)

A reassign's audit row used to encode "who handed the slot to whom" only inside
a default free-text comment — `"<from_id> → <to_id>"`, two raw user ids — which
clients could neither parse reliably nor render readably, so the approvals
timeline showed opaque identifier soup for the single most important fact of
the entry.

- `sys_approval_action` gains `reassign_from` / `reassign_to`
  (`lookup('sys_user')`), written by `ApprovalService.reassign()`.
- `comment` is pure user input again: nothing is invented when the actor
  supplies none.
- `listActions()` resolves both parties' display names into
  `reassign_from_name` / `reassign_to_name`, alongside the existing
  `actor_name`, so timelines can render "from A to B" without extra lookups.
- `ApprovalActionRow` (spec contract) declares the four new fields.

Pre-existing rows keep their legacy comment; clients should prefer the
structured fields when present and fall back to `comment` otherwise.
