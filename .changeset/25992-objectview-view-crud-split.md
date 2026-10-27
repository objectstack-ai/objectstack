---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s view management handlers move into a sibling hook

Clause-②: no
Metadata-protocol: none

The view-config panel's save and create handlers, the draft field update, view switching, the mobile view switcher registration and the view-tab CRUD callbacks (rename, delete, pin, set default, reorder, configure, add) move verbatim out of `ObjectViewInner` in `views/ObjectView.tsx` into `useObjectViewViewCrud` in `objectViewViewCrud.tsx`. The panel and dialog state stays in the component, which passes every input in and reads the returned handlers. No logic, name or rendered output changes, and the package entry is unchanged.

What to do: nothing.
