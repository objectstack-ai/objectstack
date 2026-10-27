---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s page header and record overlay move into sibling sub-components

Clause-②: no
Metadata-protocol: none

Two blocks of `ObjectViewInner`'s JSX in `views/ObjectView.tsx` move verbatim into sub-components. The page header (title, managed-by badge, icon, create button, Import, the toolbar actions, the overflow menu and the folded face) moves into `ObjectViewPageHeader` in `objectViewPageHeader.tsx`. The record detail overlay drawn for every navigation mode but `split` moves into `ObjectViewRecordOverlay` in `objectViewRecordOverlay.tsx`. The component passes every value in as a prop. No logic, name or rendered output changes, and the package entry is unchanged.

What to do: nothing.
