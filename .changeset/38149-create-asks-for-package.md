---
'@object-ui/app-shell': patch
'@object-ui/plugin-designer': patch
'@object-ui/i18n': patch
---

feat(app-shell): a create whose address names no package asks the person to pick a package or create one

Clause-②: yes (widening)
Metadata-protocol: none

The console no longer saves a new item naming no package. Where a create's package is not named, the person is asked to choose one of the packages the server says they may write (`writable: true` on `GET /api/v1/packages`, kernel packages left out), or to create a new one with the Packages page's create dialog. Nothing is written until they answer, and Cancel writes nothing.

- Setup's metadata lists: New on a list scoped by the list's own heuristic pick (no `?package=` in the address, or the one the list wrote itself) asks, with that pick pre-selected. A `?package=` the person put in the address, by a link or by the scope selector, opens the create there with no ask, as before. New waits while the package list loads.
- Setup's catalog (`?scope=environment`): New opens the create in the environment scope, and the editor's Save asks for the package, once. Studio's cross-package leg (`/studio/~all/metadata/TYPE`): New asks, with nothing pre-selected.
- The item editor at a create address naming no package (a deep link to `/new`): Save asks first; the item is saved as a draft in the chosen package and published at once, and the editor opens it under that package. A position or a permission set takes this path too, instead of the live package-less create.
- A new view or report in an app: saved into the app's writable package or its customization package, as before; where neither can be had the person is asked. In a system app the create is refused with the reason (a view: save it to My views or add it in a business app; a report: create it in a business app). Where the customization package's door refuses the caller (`403`), the create is refused with the door's reason. The "saved outside this app" notice no longer runs.
- The console's create-app route asks for the package, then saves the wizard's app as a draft there and publishes it. `CreateAppPage` (plugin-designer) takes an optional `saveApp(name, app)` that replaces its own save; answering `false` keeps the wizard open with nothing done.
- Datasource Sync lands each object through the server's import door (`POST /api/v1/datasources/:name/external/tables/:remote/import`), which places it in the datasource's package, instead of a client save naming none.
- Setup → Access control → Positions and permissions reads its own sub-path at the address the shell serves Setup at (`/apps/com.objectstack.setup/...`) as well as at the `setup` alias, so New on a position or a permission set opens the editor in Studio instead of a blank page, and a list gets the environment scope on both addresses (objectstack#38206).
- New `studio` catalogue keys `engine.packageAsk.*` (English and Chinese).

Nothing to migrate. No server route, spec key or stored row changes.
