---
'@object-ui/app-shell': patch
---

perf(app-shell): a packaged app's object route asks its lookup targets without views

Clause-②: no
Metadata-protocol: none

An object route in an app that ships in a package read the route object's lookup targets through the package scope's with-views read. A target outside the app bundle, such as `sys_user` behind an `owner` lookup, then had its views composed from the whole `/meta/view` list.

- **Now.** The lookup targets are asked by name without views, as an app without a package already asked them. They join the route's object scope as their definitions land, so lookup cells link and name their targets as before.
- **Unchanged.** The route's object, the app's `requiresObject` entries and the navigation's objects keep their views. A lookup target the package already holds asks nothing more.
