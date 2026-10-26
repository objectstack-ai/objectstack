---
'@object-ui/plugin-form': patch
---

fix(plugin-form): a `{ group }` form section no longer warns that it "also declares `collapsible`, `collapsed`" when its author wrote neither

Clause-②: no
Metadata-protocol: none

`@objectstack/spec` gives a form section's `collapsible` and `collapsed` a default of `false`, so every parsed section carries both, and it refuses them beside `group` only when they are `true`. The console's form renderer reported any value at all, so every `{ group }` section of a parsed form logged the group-owned-key warning once per page and told the author to move keys they never wrote to the object's `fieldGroups`. The renderer now reads those two keys the way the spec does: `true` beside `group` is still reported (a programmatic caller that skips the spec's parse), while `false` or absent is not. `name`, `label`, `description` and `visibleWhen` are still reported on any value.

What to do: nothing. If you moved `collapsible` / `collapsed` off a `{ group }` section because of this warning, no metadata change was needed.
