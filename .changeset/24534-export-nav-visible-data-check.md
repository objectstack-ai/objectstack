---
'@objectstack/spec': minor
---

feat(spec/ui): `navItemVisibleDataNeedsDataSource` is exported from `@objectstack/spec/ui`, so a mirror of `NavigationItemSchema` attaches the spec's own rule by identifier

Clause-②: yes (widening)

- **What is added.** One function export, `navItemVisibleDataNeedsDataSource(item, ctx)`: the refinement `NavigationItemSchema` already runs, which refuses a navigation entry with no `dataSource` whose `visible` reads `data`. It is exported the way `objectNavTargetExclusivity`, `checkPageRegionPlacement` and `checkPageMainRegionWidth` are, so a hand-written mirror of the navigation item can chain the same function in its own `superRefine` instead of restating the rule.
- **What does not change.** No schema accepts or refuses anything new. The issue is the same: one `custom` issue at `visible`, with the same message. `NavigationItemSchema` still attaches the same function, once, by name.
- **What the function reads.** It judges the entry after the spec's parse, where `visible` is the `{ dialect, source }` envelope. A bare-string `visible` (`'data.total == 1'`, the shorthand an author writes before the spec normalises it) is not read and raises nothing. So a mirror whose own `visible` stays the authored string must hand the function the parsed `{ dialect: 'cel', source }` form, or it refuses nothing.
