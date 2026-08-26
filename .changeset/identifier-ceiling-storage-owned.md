---
"@objectstack/spec": patch
---

docs(spec): state that identifier length ceilings are storage-owned (#12144)

The shared identifier schemas (`SystemIdentifierSchema`,
`SnakeCaseIdentifierSchema`, `EventNameSchema`) declare `.min()` plus a
grammar and no `.max()`. That absence is now a documented contract decision
rather than an accident: the enforced ceiling on an identifier is the
`maxLength` of the column that stores it (refused at the write seam by
ObjectQL's record validator), and the storing columns disagree — 100 for
`sys_permission_set.name` / `sys_position.name` / `sys_capability.name`,
255 for `sys_metadata.name` — so no single shared `.max()` can equal every
consumer's enforced ceiling. No accepted value changes.

A pin test in `@objectstack/plugin-security`
(`identifier-storage-ceiling-pin.test.ts`) links the spec schemas to the
storage columns that bound them, reading the widths off the registration
surface (the PR #12143 idiom), so the two cannot drift silently: a `.max()`
landing below a storing column's width, or a column width change, turns a
named test red with re-derivation instructions.
