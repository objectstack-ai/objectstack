---
'@objectstack/lint': patch
---

feat(lint): warn when a permission set's own View All or Modify All makes its field mask inert

Clause-②: yes (widening)
Metadata-protocol: none

A permission set holding View All (`viewAllRecords`) or Modify All (`modifyAllRecords`) on an object votes on every field of it in the field-permission merge (ADR-0066 D2 as amended). So that set's own `readable: false` on the object hides the field from none of its holders, and under Modify All its edit lock (`editable: false`, or `editable` omitted) holds none of them back either. The new warning `security-superuser-field-mask-inert` names the entry, the bit that unbinds it and the fix: remove the bit and reach the rows with `readScope` / `writeScope` or a row-level policy, or delete the entry if the bypass is meant. View All beside an edit lock is not reported, because View All never widens a write.

The warning never refuses anything. It runs wherever `validateSecurityPosture` runs: `os lint`, `os validate`, `os build` and the runtime publish gate for a permission set, where it is reported as an advisory.

The rule reads the bypass the way the runtime does, through `holdsSuperuserBypass`, now exported from `@objectstack/lint`: a verbatim copy of the function of that name in `@objectstack/core` (the set's own entry for the object, else its `'*'` entry, as a lookup and never a merge).
