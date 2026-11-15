---
'@objectstack/service-package': patch
---

fix(service-package): a restart serves a package's stored `installedAt` / `updatedAt`, not the boot time (#33535)

Clause-②: no
Metadata-protocol: none

The `sys_packages` boot hydration re-installed every stored row through the registry's install, which stamps `installedAt` and `updatedAt` with the moment it runs, so after each restart `GET /api/v1/packages/:id` answered the boot time for both. The hydrate now carries the row's `created_at` (the installed version's first write) as `installedAt` and its `updated_at` (its last write) as `updatedAt`. `created_at` is stored to the whole second, so the install time comes back at that precision; `updated_at` keeps its milliseconds. A package installed in the running process still stamps the moment of its install, and a row whose stamp is not readable keeps the registry's own, as before. The wire shape is unchanged.
