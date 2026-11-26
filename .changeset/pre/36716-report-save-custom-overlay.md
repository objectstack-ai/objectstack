---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): saving a report an installed app ships, from the report builder, writes the app's `.custom` customization package instead of failing with 403

Clause-②: no
Metadata-protocol: none

The report builder (and the report inspector panel beside a joined or pre-dataset report) wrote every save naming no package, so an edit to a report a read-only package ships addressed that package and the metadata write door refused it: the admin's change was lost at Save. The save now lands where the in-page dashboard editor's does (ADR-0146 D2, D3, D11): in the package the report is served from when that package is writable, else in the app's customization package `<base>.custom`, which the ensure door creates on the first save, with the report declaring the override of its base (`overrides: { package, basedOn }`), as Studio's Customize writes it. The editor's buffer is still the layered authored read at the package the report is served from, and Save still writes and publishes in one press.

Where such a save could not land, the editor is not opened and says why, in Studio's own sentences: the ensure door is walled for this caller, the package list names no installed version to declare the override at, or a draft of the report is already pending in the customization package (the in-page dashboard editor refuses that at open too). A report whose package is not listed, or whose package list cannot be read, is refused in its own sentence with the reason under it; a report of a writable package opened in the builder before this change even when the list could not be read. A report that names no package is saved as before. Two new Studio sentences carry those refusals in English and Chinese.
