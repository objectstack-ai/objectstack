---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s `renderListView` moves into a sibling hook

Clause-②: no
Metadata-protocol: none

`renderListView`, the callback the plugin `ObjectView` calls to draw a view through `ListView` (and a chart view through `ObjectChart`), moves verbatim out of `ObjectViewInner` in `views/ObjectView.tsx` into `useObjectViewListRenderer` in `objectViewListRenderer.tsx`. The column-declaration flags and the held list identity refs that only it reads move with it. The component passes every input in and reads the returned callback. No logic, name or rendered output changes, and the package entry is unchanged.

What to do: nothing.
