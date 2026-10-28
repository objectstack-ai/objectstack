---
'@objectstack/spec': minor
'@object-ui/types': minor
'@object-ui/react': minor
'@object-ui/components': minor
'@object-ui/plugin-calendar': minor
'@object-ui/plugin-gantt': minor
'@object-ui/plugin-grid': minor
'@object-ui/plugin-kanban': minor
'@object-ui/plugin-list': minor
'@object-ui/plugin-map': minor
'@object-ui/plugin-timeline': minor
'@object-ui/plugin-tree': minor
'@object-ui/plugin-view': minor
'@object-ui/plugin-detail': minor
'@object-ui/app-shell': minor
---

feat(spec,ui)!: a record opens one way per object — `navigation.mode` keeps `drawer` (now the default), `page`, `new_window` and `none`; `modal`, `split` and `popover` are retired, and a list page's `recordAction` drops `modal`

Clause-②: no (narrowing)

Metadata-protocol: narrowed (`navigation.mode` refuses `modal`, `split` and `popover`; `interfaceConfig.recordAction` refuses `modal`; an omitted `navigation.mode` defaults to `drawer` instead of `page`)

<!-- adr-0087: registered navigation-mode-overlay-values-removed, ui-record-open-overlay-modes-retired -->

**BREAKING** accept-set narrowing and default change on the record-open surface (`@objectstack/spec`), with the console following it in the same release.

The model, ruled by the maintainer: an object has one default way to open a record — the drawer, which expands to the full page (the same record page at two widths) — and `page` only for an object that declares it. A centred dialog and a popover were extra surfaces for the same record, and the side-by-side pane is each reader's own choice, not something an author fixes for every reader.

- **FROM → TO.** `navigation.mode: 'modal'`, `'split'` or `'popover'` (on a list view, an object's `listViews` entry, or a page list block: `list-view`, `object-grid`, `object-kanban`, `object-calendar`, `object-map`, `object-gantt`, `object-tree`, `object-timeline`) → delete the value; the block takes the `drawer` default. `interfaceConfig.recordAction: 'modal'` → delete the value; the default is `drawer`. Declare `page` only for an object whose record should open as a full page.
- **The one-line fix.** Delete the retired value. `os migrate meta --from 17` lists the edit for existing sources, and `--write` applies it. A stored `sys_metadata` row is converted when it is read (the `navigation-mode-overlay-values-removed` conversion), so a view saved from Studio with one of the three values keeps loading and opens the drawer.
- **What the parse says.** Each retired value is refused by name with its prescription, for example "`navigation.mode: 'modal'` was removed in @objectstack/spec 18.3.0 (ADR-0087 D2) — …", at `defineStack` as `STACK_SCHEMA_INVALID` / 422. TypeScript rejects each at a `NavigationMode` position. A misspelt mode keeps zod's own message.
- **The default.** A navigation block written without `mode` parses to `drawer` (it parsed to `page`). The console never honoured that `page` for a list with no navigation block, because it guessed the surface from the object's field count; that guess is retired too. A list of an object with no authored navigation opens a clicked record in the drawer, whatever its field count, and a mobile viewport still pages. An artifact or stored row that a released toolchain parsed carries the old `page` written out and keeps opening as a full page; delete it to take the drawer.
- **The split pane.** It is now a reader's preference, read by the console's object page from the browser (`os:record-open-mode`, `drawer` or `split`, default `drawer`). It applies only to a record that opens in the drawer; an object or view that declares `page` keeps its declaration.

The console (`@object-ui/*`): `useNavigationOverlay` defaults a block without `mode` to `drawer` and treats `drawer` as the one overlay mode. `NavigationOverlay` keeps the drawer face and the split face the console's object page draws from the preference; its `modal` and `popover` faces, the `popoverTrigger` / `popoverAnchorRef` props and the `useOverlayAnchor` export are removed, because no caller can reach them. The grid, kanban, calendar, gantt and tree renderers drop their `split` and `popover` plumbing. The registered `object-view` renderer opens records in the drawer (a page on a mobile viewport) instead of paging a field-heavy object. The Studio list-view inspector offers the four live modes, and the list page's `recordAction` the three live values.

Migration for code that imported the removed component API: drop `popoverAnchorRef` / `popoverTrigger` from a `NavigationOverlay` call and any `useOverlayAnchor()` call; pass `mode="split"` with `mainContent` for a side-by-side pane.
