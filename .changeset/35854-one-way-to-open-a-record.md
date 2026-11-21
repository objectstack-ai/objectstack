---
'@objectstack/spec': minor
'@object-ui/app-shell': minor
'@object-ui/components': minor
'@object-ui/plugin-list': minor
'@object-ui/i18n': patch
---

feat(console)!: an object's list opens a record one way — the name opens the page, the hover icon opens the side panel; `navigation.mode` is deprecated

Clause-②: yes (narrowing)
Metadata-protocol: semantic

<!-- adr-0087: not-required (runtime-export-retired @object-ui/components#NavigationOverlayProps.maximizable, @object-ui/plugin-list#ListViewProps.recordOpen) the retired operands are a prop of the drawer component and a host prop of the list, in published ui package entries; no packages/spec schema, no registered node type, no ADR-0087 conversion surface and no stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that passed `NavigationOverlay` its `maximizable` prop or passed `ListView` a `recordOpen` choice. The maintainer ruled one way to open a record from an object's list, with no setting (「这样就不需要任何设置」), and deprecated `navigation.mode` (「废弃」).

On a Console object list the record's name now opens the full record page, and the icon shown beside the name while the row is hovered (「在侧边打开」 / "Open in side panel") opens the record in the drawer over the list. There is no setting to choose between them: the Display menu's 「打开记录：抽屉 / 整页」 section and the browser-kept preference behind it are gone. A touch screen has no hover, so there the name opens the page. A ⌘/Ctrl or middle click on the name still opens the page in a new tab.

The drawer is a card floating 8 px clear of the window's top, right and bottom edges, rounded and shadowed. Its full-width "maximize in place" state is gone (a reload lost it, and the full page is the wide face): the bar's one ⤢ opens the full page. The page's 「收为抽屉」 / "Collapse to drawer" hop is gone with it.

A page the list opens remembers the list in its history entry (`location.state.from`): the list's URL (view, filters, sort, search, grouping, page), its view's name, the rows it showed and, new here, the count its query matched (`total`). A reload of the tab keeps it, and going back to that URL restores the list's scroll position. A page opened any other way carries none.

`navigation.mode` (`NavigationConfigSchema.mode`) is deprecated on an object's list (`@deprecated`, `[DEPRECATED]` describe; ADR-0087 D3 semantic entry `navigation-mode-record-open-deprecated`). The key stays in the shape and every value still parses, so existing metadata loads. On an object's list (a list view, an object's `listViews`) `drawer`, `page` and `new_window` change nothing: a view that declares one behaves as a view that declares nothing. `none` keeps "rows open nothing", because a read-only list that started opening records would be a regression nobody chose; prefer `navigation: { preventNavigation: true }`. `navigation.openNewTab: true` stays live: on an object's list the record's name then opens the full page in a new tab, and the list stays. A page's blocks that carry `navigation` (a list block, the timeline, an embedded view) still honour `drawer`, `page` and `new_window` as before: keep the key there.

The i18n keys `list.recordOpen`, `list.recordOpenDrawer`, `list.recordOpenPage`, `list.optionsMenu.recordOpenAlwaysPage`, `detail.collapseToDrawer` and `console.objectView.openAsPage` are removed from every pack, and `console.objectView.openInSidePanel` is added.

What leaves, and what to write instead:

- FROM `NavigationOverlayProps.maximizable` TO nothing, in the components package: the drawer has no full-width state. Fix: delete `maximizable`; the drawer's ⤢ opens the full page.
- FROM `ListViewProps.recordOpen` TO nothing, in the list plugin: the Display menu has no Open records section. Fix: delete `recordOpen`; the list opens a record one way.
