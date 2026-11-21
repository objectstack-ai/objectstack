---
'@object-ui/components': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(list): a phone's object list gets its own top row, one row of pills, and bottom-sheet sort, filter and view panels that apply on 「✓」

Clause-②: yes (widening)
Metadata-protocol: none

At phone width (below `sm`) the console's object list changes its containers, not its content:

- The app bar's row becomes the page's own: 「‹」, the object's icon and name, and 「⋮ More」 at the right. The app pill, the page title, the search, the bell and the avatar are not drawn while the list is on screen (the phone has them in the bottom bar and on the app's home). 「⋮ More」 offers 「Select」, the object's description, Import and the favorite.
- Below it, one row of pills: the view switcher, Sort and Filter with a count of what is in force, and Search, which expands into a field in place. There is no condition row on a phone.
- Sort, Filter, the view switcher and View settings open as bottom sheets. The sort and filter sheets edit a copy: 「✓」 applies it through the same write the desktop chips use, 「×」 drops it. The sort sheet lists each level on two lines (field over direction) with a handle a finger can drag, a ⋯ menu per level (change field, direction, remove) and 「Add sort」. The filter sheet lists the conditions, each with a ⋯ menu (edit, remove), and shows a sentence and 「Add filter」 when there are none. A view whose filter is an 「or」 group says it uses an advanced filter and is changed on a computer. View settings keeps its desktop content and applies as before.
- A long press on a card starts selecting with that card ticked, as 「Select」 in 「⋮ More」 does with none; a tap then ticks or unticks a card. The selection shows in the page's selection bar.

New exports and props:

- `@object-ui/components`: `SortBuilder` takes `layout?: 'rows' | 'stacked'`, `onAddLevel` and `onChangeLevelField`; its handle reorders by touch in both layouts.
- `@object-ui/plugin-list`: `PhonePanelSheet`, `useListPhonePanels`, `PHONE_CHIP`, `PHONE_CHIP_ACTIVE` and the types `PhonePanelSheetProps`, `ListPhonePanels`; `FilterPanel` takes `advancedOffered`.
- `@object-ui/plugin-grid`: `requestListSelection` and `useListPageSelecting`.

`@object-ui/app-shell` changes no public export: the page's top row is an internal store (`PhonePageBarProvider`, mounted by `ConsoleLayout`).
