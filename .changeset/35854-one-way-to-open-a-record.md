---
'@objectstack/spec': minor
'@object-ui/app-shell': minor
'@object-ui/components': minor
'@object-ui/plugin-list': minor
'@object-ui/i18n': patch
---

feat(console): an object's list opens a record one way — the name opens the page, the hover icon opens the side panel; `navigation.mode` is deprecated

Clause-②: no
Metadata-protocol: semantic

On a Console object list the record's name now opens the full record page, and the icon shown beside the name while the row is hovered (「在侧边打开」 / "Open in side panel") opens the record in the drawer over the list. There is no setting to choose between them: the Display menu's 「打开记录：抽屉 / 整页」 section and the browser-kept preference behind it are gone. A touch screen has no hover, so there the name opens the page. A ⌘/Ctrl or middle click on the name still opens the page in a new tab.

The drawer is a card floating 8 px clear of the window's top, right and bottom edges, rounded and shadowed. Its full-width "maximize in place" state is gone (a reload lost it, and the full page is the wide face): the bar's one ⤢ opens the full page. The page's 「收为抽屉」 / "Collapse to drawer" hop is gone with it.

A page the list opens remembers the list in its history entry (`location.state.from`): the list's URL (view, filters, sort, search, grouping, page), its view's name, the rows it showed and, new here, the count its query matched (`total`). A reload of the tab keeps it, and going back to that URL restores the list's scroll position. A page opened any other way carries none.

`navigation.mode` (`NavigationConfigSchema.mode`) is deprecated (`@deprecated`, `[DEPRECATED]` describe; ADR-0087 D3 semantic entry `navigation-mode-record-open-deprecated`). The key stays in the shape and every value still parses, so existing metadata loads. On an object's list `drawer`, `page` and `new_window` change nothing: a view that declares one behaves as a view that declares nothing. `none` keeps "rows open nothing", because a read-only list that started opening records would be a regression nobody chose; prefer `navigation: { preventNavigation: true }`. `navigation.openNewTab: true` stays live: on an object's list the record's name then opens the full page in a new tab, and the list stays. Renderers outside the object list (a page's list block, the timeline, an embedded view) still read the value until they follow.

The i18n keys `list.recordOpen`, `list.recordOpenDrawer`, `list.recordOpenPage`, `list.optionsMenu.recordOpenAlwaysPage`, `detail.collapseToDrawer` and `console.objectView.openAsPage` are removed from every pack, and `console.objectView.openInSidePanel` is added.

What moves in `@object-ui/components` (each line FROM → TO):

- `NavigationOverlay`'s `maximizable` prop: FROM a toggle that widened the drawer to the full window in place TO removed. Fix: delete `maximizable`; the drawer's ⤢ opens the full page.
- `SIDEBAR_WIDTH_FALLBACK` / `SIDEBAR_WIDTH_ICON_FALLBACK`: FROM exported constants TO no longer exported (only the removed full-width state read them). Fix: inline `'16rem'` / `'3rem'`.
