---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the layered read naming no package serves an App pair's declared override of a bundle addition's own member as `effective`

Clause-②: no
Metadata-protocol: none

An App's customization pair (`<app>.custom`) can store a row that declares `overrides: { package: Z }` for the bundle member a bundle addition Z ships, for example the `fr-FR` locale Z adds to an email template another package of the App ships in `en-US`. The plain read naming no package (`?member=fr-FR`) and `?package=Z&member=fr-FR&layers=true` already served that row. The layered read naming no package (`?member=fr-FR&layers=true`, `getMetaItemLayered` without a package) answered Z's shipped `fr-FR` as `effective`, with no `overlay`, and so disagreed with the read it describes.

It now reads such a member at the one enabled package that ships it, as the plain read does: `code` is Z's shipped member, `overlay` the pair's row, `effective` the override, and the envelope names Z. The pending draft layer stays the one the strict draft read serves. Nothing else moves: a member two packages ship, a row declaring another package, an undeclared pair row, the environment's own item and a disabled shipper answer as before. No stored row changes shape.
