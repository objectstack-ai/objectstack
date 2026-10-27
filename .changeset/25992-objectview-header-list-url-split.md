---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s header toolbar and list URL state move into sibling hooks

Clause-②: no
Metadata-protocol: none

Three concerns move verbatim out of `ObjectViewInner` in `views/ObjectView.tsx`. The header's `list_toolbar` actions, the nav `runAction` deep link and the `action:bar` node move into `useObjectViewHeaderToolbar` in `objectViewHeaderToolbar.ts`. The list's toolbar state in the URL (the seed, its write-back and "Reset view") moves into `useObjectViewListUrlState`, and the `filter[...]` equality filters with the restored user-filter selections into `useObjectViewUrlFilters`, both in `objectViewListUrlState.ts`. The component passes every input in and reads the returned values. No logic, name or rendered output changes, and the package entry is unchanged.

What to do: nothing.
