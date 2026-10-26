---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s module-level helpers move into sibling modules

Clause-②: no
Metadata-protocol: none

Module-level helpers, types and constants of `views/ObjectView.tsx` (the record links the list publishes, the saved-view tab, override and column helpers, and the small toolbar and filter helpers) move verbatim into `objectViewRecordLinks.ts`, `objectViewTabs.ts` and `objectViewHelpers.ts` beside it. No logic, name or rendered output changes. `ObjectView.tsx` keeps the component and re-exports every name it exported before, and the package entry is unchanged.

What to do: nothing.
