---
'@objectstack/spec': minor
---

feat(spec/ui): `navItemVisibleDataNeedsDataSource` is exported from `@objectstack/spec/ui`, so a mirror of `NavigationItemSchema` attaches the spec's own rule by identifier

Clause-②: yes (widening)

- **What is added.** One function export, `navItemVisibleDataNeedsDataSource(item, ctx)`: the refinement `NavigationItemSchema` already runs, which refuses a navigation entry with no `dataSource` whose `visible` reads `data`. It is exported the way `objectNavTargetExclusivity`, `checkPageRegionPlacement` and `checkPageMainRegionWidth` are, so a hand-written mirror of the navigation item can chain the same function in its own `superRefine` instead of restating the rule.
- **What does not change.** No schema accepts or refuses anything new. The issue is the same: one `custom` issue at `visible`, with the same message. `NavigationItemSchema` still attaches the same function, once, by name.
- **What the function reads.** Both spellings of `visible`, so it answers the same on an entry as authored and as parsed:
  - the authored bare string (`'data.total == 1'`), normalised by `EvaluatedExpressionInputSchema`, the slot's own schema, exactly as the spec's parse normalises it;
  - the parsed `{ dialect: 'cel', source }` envelope.

  A boolean or absent `visible` judges nothing. So a mirror whose own `visible` stays the authored string chains the function as it is and refuses what the spec refuses.
