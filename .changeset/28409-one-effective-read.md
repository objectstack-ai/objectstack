---
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

feat(metadata-protocol): one effective read — every read of a name a code package ships serves its `.custom` pair's declared override, the env-wide list and the export agree with it, and a withdrawn public form stays withdrawn (ADR-0146 D8)

Clause-②: yes (widening)
Metadata-protocol: semantic

The `overrides: { package, basedOn }` declaration (ADR-0146 D2) now takes effect on the read. Under the address of a name an installed code package X ships, the item of X's paired `<X>.custom` package that declares `overrides.package = X` is the one document served:

- **Every read agrees.** The read naming no package, the read naming X (`?package=X`), the layered read (`code` = X's document, `overlay` = the override, `effective` = the override), the list scoped to X and the env-wide list all serve the override, under X's `_packageId`. A declaration from any package that is not X's pair is ignored, and an undeclared item of the pair stays the pair's own item.
- **One predicate.** `isServedOverrideRowOf(row, basePackageId)` (new export, with its `ServedOverrideRow` type) is the one spelling of "is this stored row the served override of X's name": bound to X's pair by the row's own `package_id` (never a body stamp), of an overridable type, declaring `overrides.package = X`.
- **The env-wide list joins the one read.** For a name exactly one code package ships, a same-named row bound to another package is no longer listed beside that package's item; it stays that package's own item under its own address. A package-unbound row (the overlay Setup writes) keeps winning over the code item until the migration of ADR-0146 D11. Beside a package-unbound row the declared override is served, because a save naming no package writes the override's row there.
- **The per-package layer.** `ObjectStackProtocolImplementation#getMetaItemsPerPackage` (new public method) answers the list as it stood before this change: one item per package that holds a name, each package's own document. `GET /packages/:id/export` reads it, so the base's export carries the base unchanged and `GET /packages/<X>.custom/export` carries the overriding item with its `overrides` block.
- **Public forms.** `GET /forms/:slug` and `POST /forms/:slug/submit` offer the forms of the effective list and judge withdrawal against that list beside the per-package layer, so a form withdrawn by any body the doors honoured before stays withdrawn: a dependent package's withdrawing row still closes the base's form, and an override cannot re-open a form the base's own document withdraws. A form that only a body no longer served offered is no longer offered (the doors only narrow).
- **Orphans are reported.** A row of X's name stored in X's pair without the declaration, or in a package that depends on X, is reported by the layered read of X's name in `overlay`, with `effective` = X's document, instead of being dropped silently. A row of a package outside X's closure is not.

No request or response shape changes.
