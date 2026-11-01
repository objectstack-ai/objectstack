---
'@object-ui/app-shell': patch
---

fix(console): a package uninstalled on a cloud-managed environment is no longer drawn as installed

Clause-②: no
Metadata-protocol: none

The control plane's uninstall is a soft disable: it keeps the installation row and still lists it from `GET /api/v1/cloud-connection/installed`, with `status: 'disabled'` and `enabled: false`. The Console read every listed row as installed, so the marketplace's "Your organization" card kept saying Installed with no way to get the package back, and Setup → Packages listed it as an install.

- `listInstalledPackages()` now marks such a row `disabled` (either field saying so is enough). The marker is absent on an installed row and on every install-local entry.
- The org card draws Reinstall for a disabled package instead of the Installed badge. Reinstall calls the same install door, `POST /api/v1/cloud-connection/install`, which re-enables the row; the page then reads it as installed.
- `readMarketplaceInstalls()` leaves disabled rows out, so Setup → Packages neither lists nor acts on them.
