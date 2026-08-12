---
"@objectstack/runtime": patch
---

fix(runtime): `actionLooksDestructive` classifies on declared semantics only (#7828)

`actionLooksDestructive` (the classifier behind the MCP `list_actions` tool's
`requiresConfirmation` field) treated the mere presence of `confirmText` — UI
dialog copy — as an AI-facing destructiveness signal. #7278/#7309 are actively
migrating authors away from pairing `confirmText` with `params`-bearing actions
(the confirm question now rides `description` instead), so the heuristic's
input was being withdrawn by design: measured on #7309's branch, 6 of its 14
migrated identity actions flipped from destructive to not-destructive the
moment their `confirmText` was dropped, because none of them declares
`mode: 'delete'` or `variant: 'danger'` to fall back on.

Maintainer ruling (issue #7828, Option A): drop the `confirmText` leg.
`mode === 'delete' || variant === 'danger'` remain the signal — closed,
declared enumerations an author sets on purpose, not UI copy a heuristic
was never meant to read as a safety property.

This path is gated dead for every action shipped today (all 14 identity
actions are `sys_*`, `type: 'api'`, and none declares `ai.exposed: true`, so
none reaches the MCP `listActions` bridge that calls this classifier) — so
the change has no observable effect on any request a caller can make right
now. It closes the gap before a future `ai.exposed`, non-`sys_*` action
carrying only `confirmText` would have had its classification silently flip.
