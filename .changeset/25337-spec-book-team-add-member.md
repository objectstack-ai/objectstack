---
'@objectstack/spec': patch
---

fix(spec): book the team-side Add Member action under the `organization` feature gate

Clause-②: no
Metadata-protocol: none

`PUBLIC_AUTH_FEATURES.organization.gatedInputs` now lists `sys_team.actions.add_team_member`, right after `sys_team.actions.remove_team`. `@objectstack/platform-objects` declares that action on `sys_team` (Add Member opened from a team, which binds the team) with `requiresFeature: 'organization'`, and the booking keeps the two sides agreeing: every action gated on a feature is listed under it, and every listed input carries the gate. The membership-list copy, `sys_team_member.actions.add_team_member`, keeps its own row unchanged.

What to do: nothing. No key, value or predicate changes; the list gains one entry.
