---
'@object-ui/app-shell': patch
---

perf(app-shell): an app built in the console and a page outside the app bundle read what they name by name

Clause-②: no
Metadata-protocol: none

An app created in the console has no package, and three of its reads still downloaded a whole metadata list:

- Every route of such an app read the whole `/meta/view` list: the sidebar's capability gate composed its union of `requiresObject` names, which names other apps' objects outside this app's bundle, with their views. It now asks those names without views, as it already did outside an app, and a names-only object read composes only the views of the names its reader asked.
- An object's route read the whole object registry. It now reads the route's object, the app's `requiresObject` entries and the object's lookup targets by name; the lookup targets are asked without views. The view tabs and the view crumb keep reading their served labels from the same documents, so labels are unchanged.
- A page the app bundle does not hold (in any app) read the whole `/meta/page` list in the route, the page view and the phone title. It is now read by name, and the list is read only when the by-name answer cannot be the prefer-local pick (ADR-0048): another package's page in a packaged app, or no page at all.

Once something else has loaded a list, these readers read it and ask nothing more.
