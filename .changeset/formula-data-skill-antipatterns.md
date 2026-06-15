---
---

docs(skill): add verified anti-pattern deltas to the formula and data authoring skills

Documentation-only. Both skills were already mature, so this adds only the
*verified* gaps from this season (no padding):
- objectstack-formula: only the stdlib + CEL built-ins are callable — an UNKNOWN
  function now FAILS `objectstack build` (#1877), not a silent runtime no-op.
- objectstack-data: a `multiple: true` lookup is an ARRAY column (not a junction
  object) — reference positionally (#1872); and on insert an omitted optional
  field reads as `null` in validation predicates (#1871).
