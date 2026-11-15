---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the read naming no package serves an App pair's declared override of a bundle addition's own member

Clause-②: no
Metadata-protocol: none

An App's customization pair (`<app>.custom`) can store a row that declares `overrides: { package: Z }` for the bundle member a bundle addition Z ships, for example the `fr-FR` locale Z adds to an email template another package of the App ships in `en-US`. `?package=Z&member=fr-FR`, Z's lists and the registry's slot at Z already served that row as Z's item. The read naming no package (`?member=fr-FR`, and the execution read a send makes without a package) served Z's shipped `fr-FR` instead and dropped the declared override.

That read now takes such a member at the one enabled package that ships it when an active row of the member is that package's declared override, so it serves what Z's own address serves. Nothing else moves: a member two packages ship, a row declaring another package, an undeclared pair row, the environment's own item, a disabled shipper and the strict draft read answer as before. No stored row changes shape.
