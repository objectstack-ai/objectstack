---
'@objectstack/spec': patch
---

fix(spec): the 18.x migration entry for the action-block `destructive` → `danger` rename no longer says `element:button` keeps `destructive` (#27589)

Clause-②: no
Metadata-protocol: none

The D3 entry `ui-page-action-block-variant-destructive-refused` said that components drawing the Button primitive directly, "`element:button` and the like", keep `destructive`. That is false for `element:button`: `ElementButtonPropsSchema.variant` is `primary | secondary | danger | ghost | link`, so it already spells the arm `danger` and refuses `destructive` at the metadata save door and in `os validate`. An author who followed the sentence wrote a page the save door rejects. The entry's `reason`, which the upgrade guide prints, now says so, and names the two record blocks that do still take the React Button primitive's `destructive` because they forward a variant to it unchanged: `record:quick_actions` (`variant`) and a `record:alert` action (`action.variant`). The same correction is made to the docblock of the D2 conversion `page-action-block-variant-destructive-to-danger`. No schema, value or conversion behaviour changes.

**Supersedes, in the same release.** The `@objectstack/spec` 18 note for the rename says "Other components that draw the Button primitive directly (`element:button`, toasts, alerts, badges and the like) keep `destructive`". Read `element:button` out of that list: it spells the arm `danger`, as the action blocks now do.
