---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s view-options family moves into a sibling module

Clause-②: no
Metadata-protocol: none

The per-kind `options` blocks `views/ObjectView.tsx` hands `ListView` (`timelineViewOptions`, `calendarViewOptions`, `ganttViewOptions`, `galleryViewOptions`, `kanbanViewOptions`), `storedLegacyOptions`, the by-value options comparison and `dispatchViewPatches` move verbatim into `objectViewOptions.ts` beside it. No logic, name or rendered output changes. `ObjectView.tsx` re-exports every name it exported before, and the package entry is unchanged.

What to do: nothing.
