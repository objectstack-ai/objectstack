---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(app-shell,plugin-detail,components,i18n): the record page's timeline and related columns are each reader's switches, per object, toggled from the crumb row

Clause-②: no
Metadata-protocol: none

Whether the record page shows its timeline column and its related column is now the reader's own choice, per object, kept in the browser. It is not metadata: no key, no spec change.

- **Defaults derived from the object.** A reader who never chose gets the timeline on for a "worked" object and off otherwise, and the related column on. An object is worked when `stageField` names a field, when a field's options declare a lifecycle `kind` (unless `stageField: false`), or when it sets `enable.files: true` — only what the object declares of itself. Being another object's `master_detail` parent does not count: a container that owns child rows (a price book, a campaign) is not a worked record. `recordTimelineDefaultReason` and `recordPageColumnDefaults` in `@object-ui/plugin-detail` say which.
- **A switched-off column frees its room.** With the timeline off, a wide page draws details | related, and the timeline's blocks (the composer and History) become an Activity card at the foot of the related column. With the related column off, it stays behind the rail toggle. `recordPageArrangementFor` is the rule, and `RecordPageColumns` takes the reader's `switches`. Below the column widths the page is tabbed as before, the switches are kept for when it widens, and `?tab=` is unchanged.
- **Panel toggles.** `PanelToggles` in `@object-ui/components` is a group of icon toggles with `aria-pressed`, a tinted pressed state, and a tooltip naming the shortcut. The record page draws it on its crumb row, right side, only in a column tier. It is not drawn in the drawer or split pane.
- **Shortcuts.** `⌘⇧.` / `Ctrl+Shift+.` toggles the timeline and `⌘⇧,` / `Ctrl+Shift+,` the related column, matched by the physical key. Not `⌘⇧T` / `⌘⇧R`: the browser keeps those (reopen closed tab, hard reload) and the page never receives them. They do nothing while a text field has focus, and the keyboard-shortcuts dialog lists them while the record page is open.
- **One preference store.** `app-shell`'s `workspacePreference` module keeps every reader preference by preference and scope (`user`, or `object:OBJECT_NAME`). Each value is a small record with a version `v`. It reads live through `useSyncExternalStore`, follows other tabs, and falls back to the default with no storage. The record-open preference (`os:record-open-mode`) is now a thin alias over it and keeps its stored spelling, so a reader's earlier choice reads back unchanged.
