---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the read naming no bundle member serves an App pair's declared override of the canonical member a bundle addition ships

Clause-②: no
Metadata-protocol: none

A read that names no bundle member addresses the canonical one (`en-US` for an email template), the same request as `?member=en-US`. When a bundle addition Z ships that canonical member beside another package's member of the same name (for example X ships `fr-FR`), and the App's customization pair (`<app>.custom`) stores a row declaring `overrides: { package: Z }` for it, `?member=en-US` already served the override. The plain read, the execution read and the layered read naming no member (`GET /meta/email_template/:name`, `?layers=true`) served Z's shipped `en-US` instead, and `/published`, which asks the layered read for its overlay exit, found no runtime-published row there.

They now judge the canonical member as `?member=en-US` does and read it at Z: the override is served, the layered `effective` is the override with Z's shipped member as `code`, and `/published` serves the override. The strict draft read and the layered draft layer stay where they were. Nothing else moves: no override declared, an undeclared pair row, a row declaring another package (still refused naming both), another package's own member, the environment's own item, a disabled shipper, and a bundle that ships no canonical member answer as before. No stored row changes shape.
