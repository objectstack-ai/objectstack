---
"@objectstack/lint": minor
---

feat(lint): uniqueness-scope rules speak the ADR-0120 vocabulary (#4986, D5a/D5b)

- **New rule `unique/unscoped-declared-index`** (warning, advisory): a declared
  index with bare `unique: true` — the spelling whose scope is unstated, the
  #4986 trap. Fires on the spelling alone (no tenancy/posture inference —
  `organization_id` is kernel-injected at registration, so an authoring-time
  guess would be wrong half the time; see #4698). The fix names both words:
  `'global'` (installation-wide — exactly today's behavior) or
  `'organization'` (one holder per organization). Protocol 18 rejects the
  spelling (#5082). Exported as `lintUnscopedDeclaredIndexes` +
  `UNIQUE_UNSCOPED_DECLARED_INDEX`, registered as its own AUTHORING_RULES
  entry (validate/build) and called by `lintDataModel` for `os lint`, so all
  three commands report it — each finding exactly once.
- **R10 `unique/double-declaration` rewritten as the four-quadrant scope
  matrix** (ADR-0120 D5b): field `true`/`'organization'` × declared `'global'`
  (or bare `true`, its deprecated spelling) on the same single column =
  CONTRADICTION (the installation-wide index wins physically; the
  per-organization intent is silently dead) — and the mirror, field `'global'`
  × declared `'organization'`, likewise; same scope on both sides = REDUNDANCY
  (the same index declared twice). The old field-`'global'` exemption is gone
  (now reported as redundancy), and the fix text replaces the hand-written
  `fields: ['organization_id', …]` advice with the `'organization'` spelling —
  the hand-written composite is not NULL-safe (#5030).
