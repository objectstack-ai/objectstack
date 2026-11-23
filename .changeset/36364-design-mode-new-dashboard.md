---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): a new dashboard is created from the design mode's 「Add menu item」 and opens for editing

Clause-②: yes (widening)
Metadata-protocol: none

In the design mode's 「Add menu item」 picker, the 「Dashboards」 list now starts with 「New dashboard…」, above the existing dashboards that are not in the menu yet. It asks for a name only. 「Create」 creates the dashboard, empty, in the package the menu is saved to (the app's package when it is writable, else its customization package), publishes it, puts its entry in the place the editor held for it, and saves the menu with every other change staged in the mode; the mode is then left and the new dashboard opens in its page's edit state. Members see the empty dashboard, not an error. 「Cancel」 writes nothing and leaves nothing in the menu. Where the menu cannot be saved (the app's package is not listed, an installed app states no version, or its customization package cannot be had or written) nothing is created. When the menu save is refused after the dashboard was created, the dashboard is removed again, the mode stays on and the reason is said. The machine name is generated from the name (a Chinese name through its pinyin), unused by any dashboard. A report cannot be created this way yet: a report needs a dataset and measures before it can be published. New `@object-ui/i18n` keys under `designMode.menu`.
