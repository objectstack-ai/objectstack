---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s list toolbar affordances move into a sibling hook

Clause-②: no
Metadata-protocol: none

The environment list's entitlements, the object's list actions and their localized toolbar copies, and the create and import buttons' toolbar-scope predicates move verbatim out of `ObjectViewInner` in `views/ObjectView.tsx` into `useObjectViewToolbarAffordances` in `objectViewToolbarAffordances.ts` beside it. The object-level verdicts (`resolveAffordance`) stay in the component and are passed in with every other input. No logic, name or rendered output changes, and the package entry is unchanged.

What to do: nothing.
