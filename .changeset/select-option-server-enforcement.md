---
'@objectstack/objectql': minor
---

Enforce per-option `visibleWhen` server-side (objectui#2284).

A `select`/`multiselect`/`radio` option may gate itself with a `visibleWhen` CEL
predicate. Client-side hiding is UX, not a security boundary, so on write the
engine now re-evaluates the picked value's predicate against the merged record +
`current_user` and rejects a clean FALSE (`invalid_option`). This enforces both
role/context gating (`'admin' in current_user.roles`) and cascade integrity
(`record.country == 'cn'`) that a caller could otherwise bypass by submitting a
hidden value directly.

- Only WRITTEN choice fields are checked; an unchanged persisted value is left
  alone. Multi-select values are checked element-wise.
- A predicate that can't be evaluated (missing referenced field, or an unbound
  `current_user` on a system write) is fail-open — matching every other
  field-level rule — so broken cascade predicates never brick a write.
  Authorization gating relies on the engine binding `current_user`, which it now
  does from the execution context on authenticated insert/update.
- `needsPriorRecord` accounts for option `visibleWhen` so a cascade predicate can
  read an unchanged sibling from the prior record on update.
