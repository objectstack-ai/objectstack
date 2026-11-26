---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the Studio landing opens package management in one click

Clause-②: no
Metadata-protocol: none

Studio's landing (the App Builder home at `/_console/studio`) is now the visible door to package management. Every package card carries **Manage**, which opens the same detail sheet as the top-bar package switcher's "Package info & settings": Disable where the server says the package can be switched off (a module of an installed app, or your own app), Enable on a disabled package, and export. The title row gains an **All packages** link to the unfiltered Packages page. Before, the only way in from a menu was to open a package, open the package switcher and pick its last entry, so admins of code-loaded modules looked for Disable and did not find it.
