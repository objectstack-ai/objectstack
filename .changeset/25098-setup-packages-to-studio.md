---
'@objectstack/platform-objects': patch
---

feat(platform-objects): Setup no longer carries the unfiltered Packages entry; the full package list lives in Studio

Clause-②: no
Metadata-protocol: none

The full `developer:packages` list is a development surface, so its one unfiltered navigation entry is now Studio's Overview → Packages, which is unchanged. Setup's `group_apps` drops its `nav_packages` entry. Setup keeps the marketplace-filtered "Installed Apps" door (`nav_marketplace_installed`, contributed by `@objectstack/cloud-connection` wherever the marketplace capability is present), so its Apps group reads Browse Marketplace, Installed Apps and Packaged Actions.

The Setup copies of the entry's label (`apps.setup.navigation.nav_packages` in `en`, `zh-CN`, `ja-JP` and `es-ES`) and their recorded source hashes are removed with it; Studio's copies stay. A bookmark to the Packages page keeps working, since the page itself did not move.
