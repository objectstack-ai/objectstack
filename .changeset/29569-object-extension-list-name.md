---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): an `object_extension` list row names and opens the object it extends

Clause-②: no
Metadata-protocol: none

An `object_extension` item is stored under the name of the object it extends, and its body carries `extend` and no `name` (`ObjectExtensionSchema` refuses one). The metadata list read `name`, so in Studio's All metadata area a customization package's extension row showed "—" in its name cell and linked to `…/object_extension/(unnamed-0)`, an empty page. The type now declares `extend` as its identity key: the row shows the extended object (for example `showcase_task`) under an "Object" header, its link opens that extension in its own package, the search box matches it, and its customization mark is looked up by it. Rows of every other type are unchanged.
