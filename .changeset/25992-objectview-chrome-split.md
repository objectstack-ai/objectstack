---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s leaf pieces move into a sibling module

Clause-②: no
Metadata-protocol: none

The "object not found" state (`ObjectNotFoundState`), the viewport check that decides whether the saved-view tab strip is drawn, and the inline-edit toggle's session-only callback move verbatim out of `views/ObjectView.tsx` into `objectViewChrome.tsx` beside it. No logic, name or rendered output changes. `ObjectView.tsx` re-exports every name it exported before, and the package entry is unchanged.

What to do: nothing.
