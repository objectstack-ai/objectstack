---
'@object-ui/app-shell': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

feat(console): the list page's top reads the object's row, the view bar, then the condition row; 「Import / Export」 and 「New Account」 end the view bar

Clause-②: yes (widening)
Metadata-protocol: none

An object's list page draws three rows above its table again:

- **The object's row** — the console `PageHeader` in its list posture: the object's icon and plural name, ended by the shell's top-right button group where the shell turns it on. It carries none of the page's acts.
- **The view bar** — the view switcher and 视图设置 on the left; the search, 「Import / Export」, the authored list toolbar actions, 「New Account」 and ⋮ More on the right. The view bar no longer leads with the object's name.
- **The condition row** — the sort and filter chips, and Discard / Save while the list holds a draft, as before.

「Import / Export」 holds Import and one entry per export format the reader may use. ⋮ More keeps the object's description and the favorites entry; Import is no longer in it. While the list is narrower than 896px, 「Import / Export」 folds into ⋮ More; below 768px the search keeps its icon alone, without the active keyword. The 视图设置 panel keeps its export entries. The create button names what it creates (`console.objectView.newObject`, 「New {{object}}」, in every locale). A phone's list header is unchanged.

`@object-ui/plugin-list`: `ListView`'s `toolbarTrailing` host prop is now called with a second argument, `ListToolbarTrailingState`, whose `export` is the list's export door (`ListExportDoor`: the formats, `run`, `busy`, `error`), absent where the list offers no export. Both types are exported. A host that reads only the first argument is unchanged.
