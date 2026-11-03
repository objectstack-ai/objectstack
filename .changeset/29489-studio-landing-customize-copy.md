---
'@object-ui/i18n': patch
---

fix(i18n): the Studio landing page tells users to customize a read-only package in its `.custom` customization package, not with an environment overlay

Clause-②: no
Metadata-protocol: none

The App Builder landing page's description (`engine.studio.landing.description`) and its read-only section hint (`engine.studio.landing.readonlyHint`) told users to customize a code or installed package "with an environment overlay". A write naming no package onto an item a read-only package ships is now refused with `403 NOT_OVERRIDABLE`, and the refusal names the package's `.custom` pair. Both strings, in English and Chinese, now name the route that is open: open an item and choose Customize or New similar; the change is saved in the package's `.custom` customization package, and upgrades keep reaching the installed package.

Only the two values change. No key is added or removed, and nothing else on the page changes.
