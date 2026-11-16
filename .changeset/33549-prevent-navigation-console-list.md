---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): a list view authored `navigation.preventNavigation: true` opens no record and draws no link face

Clause-②: no — an authored key starts being honoured; no surface added
Metadata-protocol: none

The spec describes `navigation.preventNavigation` as "Disable standard navigation entirely". The Console's object list did not read it: a `drawer` view with the flag still opened the record drawer on a row click (it wrote `?recordId=`), and a ⌘, Ctrl or middle click still opened the record in a new tab. Its rows also kept their link face: the first column drew as the record link and the right-click menu offered Open and Open in new tab.

On a desktop, the Console's object list now resolves such a view the way it resolves a view authored `navigation: { mode: 'none' }`, whatever mode the view names. A row click opens nothing, a modifier click included. The record-link column draws plain text, and the right-click menu offers no Open items. The row's actions stay. A view without the flag, or with `preventNavigation: false`, opens its records as before. On a phone the list is unchanged: a tap still opens the record's page.
