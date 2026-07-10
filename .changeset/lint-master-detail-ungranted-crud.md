---
'@objectstack/lint': patch
---

feat(lint): warn when a master-detail child has no object-level CRUD grant (ADR-0090 D7)

New security-posture rule `security-master-detail-ungranted` (advisory
`warning`; it does not gate the build). A master-detail DETAIL object derives
its RECORD-level access from the master (ADR-0055 `controlled_by_parent`,
gate ②), but object-level CRUD is a SEPARATE gate ① (`checkObjectPermission`)
that is never derived — a permission set that grants the parent but forgets the
child denies role-bound non-admin users a 403 before the parent-derived access
is ever consulted, surfacing as the silent "can't fill in / can't submit the
subtable" trap (framework#2700, downstream os-tianshun-mtc#43).

The rule flags a non-system detail (has a `master_detail` field) that NO
authored permission set grants (explicit entry or `'*'` wildcard). It stays
silent when the package authors no permission sets, when a package-declared
`'*'` wildcard grant covers every object, or for `sys_*` / `isSystem` objects —
keeping the false-positive rate near zero. The residual per-set gap (one role
grants it, another forgets it) is intentionally out of scope, and CRUD
auto-inheritance is deliberately NOT adopted (secure-by-default, Salesforce
parity).
