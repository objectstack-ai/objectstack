---
"@objectstack/spec": patch
"@objectstack/plugin-security": patch
---

feat(security): the explain engine reports a DEACTIVATED permission set / position as a held-but-not-resolving contributor state, sharing one vocabulary with the ADR-0091 expired state (#8714)

ADR-0091 validity windows and the ADR-0049 `active` switch are structural
siblings — both resolution-time, fail-closed filters that can make a grant a
user visibly held yesterday stop resolving today. The explain engine narrated
only one of them: an expired grant reported "held until … — expired", while a
deactivated permission set or position simply vanished from
`layers[].contributors[]`, answering exactly like a grant that never existed.
Deactivation is an incident-response, installation-wide control with no date on
the user's own grant row, so the silence hit precisely where attribution
matters most.

Per the 2026-08-18 maintainer ruling, the two lifecycle controls now share ONE
"held but not resolving, because X" vocabulary:

- `@objectstack/spec`: `ExplainLayerSchema.contributors[].state` widens from
  `['active', 'expired']` to `['active', 'expired', 'deactivated']` — a closed
  enumeration of reasons, extended only deliberately (an unknown state such as
  `'suspended'` is still refused, and stays pinned as refused). Widening only:
  every payload that parsed before parses unchanged.
- `@objectstack/plugin-security`: the explain-only provenance pass re-reads the
  grant rows it already walks (`sys_user_position`, direct
  `sys_user_permission_set` grants at the existing by-id `sys_permission_set`
  read) and reports a held row whose catalogue entry is switched off as
  `{ state: 'deactivated', via: 'held — deactivated' }`, judged by the same
  shared `isRowActive` predicate the resolver enforces with. The resolver's
  fail-closed dropping is untouched — this is presentation, never aggregation.
  A row both expired and deactivated reports `expired` (one reason per row,
  resolver drop order).

Internal (not a public contract): `buildContextForUser`'s context annotation
`expiredGrants` is replaced by `droppedGrants`, one array whose entries carry
the same closed reason enumeration (`state: 'expired' | 'deactivated'`) instead
of a per-cause sibling array.
