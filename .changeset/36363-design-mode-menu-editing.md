---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the app's menu is edited in the design mode, and an installed app enters it too

Clause-②: yes (widening)
Metadata-protocol: none

While the design mode is on, the sidebar draws the app's menu with its editor. Each group, and the menu's top level, ends with 「Add menu item」: it holds a dashed row 「Choose a menu item…」 where the entry will go and opens a picker that searches the app's existing objects, views, dashboards, reports and pages (and takes a link), offering only what is not in the menu yet. Each entry has a 「⋮」 menu (move up, move down, move to a group, add an item before or after it, rename and icon, remove from the menu) and can be dragged to another place or group. Removing takes the entry off the menu only; the picker offers it again.

The edits are staged with the mode: 「Save」 writes the app with its new menu where Studio's menu editing writes it (the app's package when it is writable, else its customization package, declaring the override at the package's version) and publishes it, so every member sees it; 「Cancel」 drops them. A draft of the app already pending (in Studio) is not overwritten: the save says so and keeps the mode on. The save is composed from the app as stored, never as served: the menu a member is shown is translated into their language and pruned of what they may not open, so the edits are replayed by entry id on the stored menu, and every entry they did not touch is written back as it was. Renaming an entry is offered in the deployment's default language only, and only while the entry shows its stored name; in any other language the name field is closed and says that menu names are changed in the app's source language. Adding, moving and the icon stay open in every language. An entry another package puts into the menu (its `navigationContributions`) is not in the app's stored menu, so its 「⋮」 says it is changed in that package, and it is not moved, renamed or removed here. Such entries are added after the app's own entries when the app is served, so an entry added or moved to the end of their group is drawn before them, where everyone will see it.

「Edit app」 now enters the mode on an installed (read-only) app as well, where the customization door takes the caller; where it is walled off (a walled deployment, not the platform operator) the eye into Studio stays. An app whose menu is split in areas keeps its menu unedited in the mode. New `@object-ui/i18n` keys under `designMode.menu`.
