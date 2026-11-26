---
'@object-ui/app-shell': patch
'@object-ui/layout': patch
---

feat(studio): the Studio left menu is drawn as the app's menu, in Studio's own graphite

Clause-②: no
Metadata-protocol: none

- **Groups collapse the way the app menu's do.** Each of the menu's groups is the app menu's collapsible group: its label is a disclosure button with a chevron, open by default, and a search opens every group it lists. A group still carries no count: a number in the Studio menu is an entry's items.
- **An entry is the app menu's row.** It draws a bare line icon (no tile) before its name, at the app menu's row size; the open page's entry is the app menu's inset pill with a bar on its left edge.
- **Studio's own accent.** The pill and the bar are graphite, light and dark, whatever the app's theme colour is (`STUDIO_ACCENT` in the Studio tokens); only the app's logo keeps the app's colour.
- **New export: `NavigationGroupSection`** (`@object-ui/layout`), the collapsible sidebar group the app menu draws every `group` entry with. The app menu renders exactly as before.
