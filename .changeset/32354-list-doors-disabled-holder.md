---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: the metadata lists serve nothing a disabled package's customization pair or a dependent's added bundle member carries for it (ADR-0150 D3, #32354)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are list reads under a reversible package state: no stored row changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a reader of a metadata list while a package is disabled. A disabled package holds no name (ADR-0150 D3), and the by-name reads already withheld what it carries; three lists still served it, by the order things were registered and saved. Measured over a real `SchemaRegistry`, both registration orders, the pair's row stored before and after: package A ships `welcome` in `en-US`; its pair `A.custom` stores a `fr-FR` row of it, or package DEP (depending on A) ships a `fr-FR` addition to A's template; A is disabled.

- `GET /meta/email_template` and the execution list (`getMetaItemsForExecution`, no package): the pair's `fr-FR` row and DEP's `fr-FR` addition were listed → not listed, with one holder or beside an enabled second holder of the name. A send naming no package reads this list, so it no longer sends either while A is disabled.
- `GET /meta/email_template?package=A` and its execution list: the pair's `fr-FR` row was listed → `[]`, as `?package=A&member=fr-FR` answers 404.
- `GET /meta/email_template?package=A.custom`: the pair's `fr-FR` row was listed → not listed, as `?package=A.custom&member=fr-FR` answers 404.

The rule is the exact read's: a list scoped to a package serves no name whose exact read at that package is a disabled package's withheld item; the list naming no package leaves out an item whose own package's address is, and a bundle addition whose every base in its dependency closure is disabled. It applies to every package-scoped type, and only while some package is disabled.

**Not moved.** With nothing disabled, every list answers as before. DEP's own list (`?package=DEP`) keeps its addition, as its exact read does. An enabled holder's lists, the pair's own item of a name A ships nothing of, and the per-package layer (the package export, which keeps a disabled package's items) answer as before. Re-enabling A restores every list.

Until the email send door judges the served holders (#32670), a send made from DEP itself reads the list naming no package for this name, so it no longer finds DEP's `fr-FR` while A is disabled.

The fix for a reader: re-enable the package to list its customization again; a dependent's addition stays readable at the dependent's own address.
