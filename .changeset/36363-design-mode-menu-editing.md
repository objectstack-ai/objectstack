---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the app's menu is edited in the design mode, and an installed app enters it too

Clause-②: yes (widening)
Metadata-protocol: none

While the design mode is on, the sidebar draws the app's menu with its editor. Each group, and the menu's top level, ends with 「Add menu item」: it holds a dashed row 「Choose a menu item…」 where the entry will go and opens a picker that searches the app's existing objects, views, dashboards, reports and pages (and takes a link), offering only what is not in the menu yet. Each entry has a 「⋮」 menu (move up, move down, move to a group, add an item before or after it, rename and icon, remove from the menu) and can be dragged to another place or group. Removing takes the entry off the menu only; the picker offers it again.

The edits are staged with the mode: 「Save」 writes the app with its new menu where Studio's menu editing writes it (the app's package when it is writable, else its customization package, declaring the override at the package's version) and publishes it, so every member sees it; 「Cancel」 drops them. A draft of the app already pending (in Studio) is not overwritten: the save says so and keeps the mode on.

「Edit app」 now enters the mode on an installed (read-only) app as well, where the customization door takes the caller; where it is walled off (a walled deployment, not the platform operator) the eye into Studio stays. An app whose menu is split in areas keeps its menu unedited in the mode. New `@object-ui/i18n` keys under `designMode.menu`.
