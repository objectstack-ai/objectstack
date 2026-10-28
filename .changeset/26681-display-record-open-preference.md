---
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

feat(plugin-list,plugin-grid,i18n): the Display menu's Open records section — the reader's drawer | split preference, or the object's declared full page — and a host node beside each row's record link (#26681)

Clause-②: no
Metadata-protocol: none

- **`@object-ui/plugin-list`**: `ListView` takes a `recordOpen` host prop and hands it to the Display menu (`ViewSettingsPopover`), which draws an Open records section after Layout. For a drawer-mode object it offers two segments, Drawer | Split, writing the reader's own preference through the host's `setPreference`, with a note that the choice is the reader's and that both expand to the full page. For an object or view that declares `navigation.mode: 'page'` it draws one read-only line instead; for `new_window` and `none`, nothing. A host that passes no `recordOpen` draws no section, so every other host is unchanged. It is a host prop, not a view key: no metadata is added, and the section neither counts toward the Display trigger's changed-settings count nor returns under "Reset to view default".
- **`@object-ui/plugin-list`** and **`@object-ui/plugin-grid`**: `ListView` and `ObjectGrid` take a `recordLinkAdornment` host prop — a node drawn beside each row's record link, after the anchor and never inside it: beside the first column the view links (`link: true`), else beside the auto-linked primary field. `rowAdornment` is unchanged: it sits beside the row's title, which need not be where the record opens from. The console passes an "open as full page" arrow through it for a row that opens the drawer. Absent, the link cell is exactly the anchor it was.
- **`@object-ui/i18n`**: the section's five `list.*` strings (`recordOpen`, `recordOpenDrawer`, `recordOpenSplit`, `recordOpenNote`, `recordOpenDeclaredPage`) and `console.objectView.openAsPage`, the tooltip of the console list's open-as-full-page arrow, in all ten packs.
