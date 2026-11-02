---
'@object-ui/app-shell': patch
---

fix(app-shell): an app that shares its package with the package's first app opens itself from the avatar menu, the ⌘K palette, the app switcher, Home's tiles and the report index's other-apps links

Clause-②: no
Metadata-protocol: none

`/apps/PACKAGE_ID` opens a package's first app, so a link keyed on the package id cannot reach the package's other apps; their name is the only address that does. The avatar menu's entry for a hidden app linked to its package id, so a hidden app shipped beside its package's main app (a settings-style app) opened the main app instead and could not be reached from the menu at all. The ⌘K palette's "Switch app" items, the app switcher's rows, Home's "Your apps" tiles (and the `app:launcher` block, which draws the same tiles) and the empty report index's "Reports in your other apps" links had the same fault for every non-first app of a package.

Each now links to the app's one address, the address the Console already resolves an open app to: the package id when it opens this very app, else the app's name. An app that is the only or first app of its package keeps its package-id address. Home's tiles resolve the address among the full app list, hidden apps included, so a visible app behind its package's hidden first app also opens itself.
