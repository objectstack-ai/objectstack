---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the Packages page offers Disable / Enable on a suite's module rows, from the server's `disableable` verdict

Clause-②: no
Metadata-protocol: none

The package detail sheet now offers **Disable** where the runtime's disable door accepts the package: the row's served `disableable` key on `GET /api/v1/packages`, never re-derived from `manifest.type`, `scope` or `writable`. A `type: 'module'` package of an installed app is `disableable` and not `writable`, so its row (listed in **Setup → Installed Apps** when the suite came from the marketplace, and in **Setup → Packages** when it was booted from code) now shows **Disable**, behind the same confirm dialog, and **Enable** once it is disabled. Every other write action (Edit, Publish, Revert, Duplicate, Adopt loose items, Delete) stays hidden on it, since it is still read-only for authoring, and its read-only note says it can be disabled. A row that carries no `disableable: true` offers no Disable; Enable is still offered on any disabled package.
