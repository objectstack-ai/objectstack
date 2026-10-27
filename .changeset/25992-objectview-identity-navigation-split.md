---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s identity import and record navigation move into sibling hooks

Clause-②: no
Metadata-protocol: none

Two concerns move verbatim out of `ObjectViewInner` in `views/ObjectView.tsx`. The identity-import gate, its password-policy state and data source, and the managed-environment Users marker move into `useObjectViewIdentity` in `objectViewIdentity.tsx`. The record navigation overlay (how a row opens its record, the drawer's `?recordId=` URL state, "expand to full page" and the list's record links) moves into `useObjectViewRecordNavigation` in `objectViewRecordNavigation.ts`. The component passes every input in and reads the returned values. No logic, name or rendered output changes, and the package entry is unchanged.

What to do: nothing.
