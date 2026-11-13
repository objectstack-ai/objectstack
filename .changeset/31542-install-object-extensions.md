---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the marketplace install dialog and the local-install confirm show which existing objects a package changes, platform objects flagged and acknowledged

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`:** a new `ObjectExtensionDisclosure` draws the catalog's `object_extensions` for the version being installed: each existing object the package extends, with the fields it adds or replaces, the fields whose display it patches, the validation rules it adds or replaces, how many indexes it adds and whether it overrides the object's label. A platform (`sys_*`) object is flagged and listed first. It is drawn in the hosted install dialog for every package (not only for a package that contains code) and in the local-install confirm, and when any target is a platform object the install waits for an acknowledgment checkbox. `[]` draws nothing; `null` says what the package changes could not be read, never that it changes nothing. On a catalog that does not serve the key yet, the same list is read from the manifest the page already reads before the install (`InstallPreview.objectExtensions`).
- **`@object-ui/i18n`:** the lazy `marketplace` namespace (`@object-ui/i18n/namespaces/marketplace`) gains the `marketplace.objectExtensions.*` keys in every locale; `zh-Hant` is generated from `zh-Hans`. No key changes or leaves.
