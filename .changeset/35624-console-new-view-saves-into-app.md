---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): a view added in an app is saved into that app, so its draft preview bar counts and publishes it

Clause-②: yes (widening) — one new published language-pack key, view.savedOutsideApp, in all eleven packs (the fallback notice the maintainer's ruling 7024102451 names)
Metadata-protocol: none

Add new view and Save as view used to save the new view's draft naming no package. The app's draft preview bar counts only the app's package and its customization package, so right after the create it said "no unpublished changes" while the draft was pending, and its Publish left the new view unpublished. A view created inside an app is now saved into the app: into the app's own package when that package is writable, else into its customization package (`BASE.custom`), which is created on first use. The bar counts the view at once, its Publish publishes it, and the view travels with the app's customization. Editing, discarding and publishing the view afterwards reach that same draft. Views saved without a package before this change keep their address. When the customization package cannot be used (an isolated multi-tenant deployment refuses a tenant administrator), the view is saved without a package as before, and a notice says that this app's draft bar does not count it and that it is published from Home. Reports, dashboards and pages are created as before.
