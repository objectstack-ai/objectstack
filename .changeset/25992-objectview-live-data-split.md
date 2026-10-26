---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s realtime refresh and record-count fetch move into a sibling hook

Clause-②: no
Metadata-protocol: none

The realtime subscription that refreshes the list when the server reports a change, the reconnection conflict resolution, and the footer's `$top: 0` record-count fetch move verbatim out of `ObjectViewInner` in `views/ObjectView.tsx` into `useObjectViewLiveData` in `objectViewLiveData.ts` beside it. The component calls the hook at the same place, so the hook order is unchanged; the record-count state stays in the component and is passed in with the other inputs. No logic, name or rendered output changes, and the package entry is unchanged.

What to do: nothing.
