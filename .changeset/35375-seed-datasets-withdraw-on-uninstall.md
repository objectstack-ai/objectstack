---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an uninstall takes the package's seed datasets off the shared replay list

Clause-②: no
Metadata-protocol: none

Uninstalling a package through the install-local door in a running process left its entries on the shared `seed-datasets` list that per-organization seed replay reads, so every organization founded before the next restart replayed the removed package's seed sets, over objects that may no longer exist. The uninstall now merges an empty list under the package id once the running kernel has withdrawn the package (the owner-keyed replace an upgrade already uses), so the list matches the installed set without a restart. A composed bundle's entry withdraws the datasets it merged for all of its package bodies; another package's datasets are kept. An uninstall the registry refuses, or whose withdrawal from the running kernel is refused, leaves the list as it was: the package stays loaded until the restart, and its datasets with it.
