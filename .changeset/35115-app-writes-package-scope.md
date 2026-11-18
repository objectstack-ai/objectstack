---
'@object-ui/plugin-designer': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(plugin-designer, app-shell): a packaged app is saved at its package, not at the package-less address

Clause-②: no
Metadata-protocol: none

The Edit app wizard read a packaged app at its package but saved it with no package, and the navigation sync that adds or removes an entry when a page or dashboard is created or deleted read and saved every app with no package. Both now read and save an app a package owns with `{ packageId }` (sent as `?package=`), the row the console serves, the way App management already saves it. An app no package owns, including one served with the `sys_metadata` sentinel, keeps the package-less address. A managed package's sealed app is still refused by the server at either address, and the navigation sync still skips it.
