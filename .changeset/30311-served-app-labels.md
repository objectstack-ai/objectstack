---
'@object-ui/app-shell': patch
---

fix(app-shell): every Console surface that names an app draws the served app label as served

Clause-②: no
Metadata-protocol: none

- **Now.** The app switcher, the sidebar's app title, the top bar's hidden-app menu, Home's app cards, apps strip, recent rows and setup link, the no-access empty state, the AI chat's app names, the marketplace's "Open app" buttons and the report index's other-app links draw the app `label` (and the app card its `description`) the `/meta/app` read served, as given. The server has already translated it, by its label order for an overridden app: a `.custom` pair's own text is kept over the base package's translation. Before, the served label reached the client's `apps.<name>.label` catalog lookup only as its fallback, so the base package's translation of the old name won.
- **Unchanged.** A pending draft under `?preview=draft`, a keyed label and an app with no label or description are still named by the catalog key, then by the machine name as before. An unedited app shows the same text as before, because the server serves the catalog's translation for it.
