---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the boot's sealed-overlay report no longer counts a served `.custom` override or tells the operator to delete it (#28771)

Clause-②: no
Metadata-protocol: none

At boot, `[metadata_sealed_overlay_unserved]` lists the environment rows that overlay sealed managed content, says no read serves them, and prescribes deleting each stored row. Since #28412 the shipping package's declared override in its paired `<base>.custom` package is served, and for a flow it is armed in place of the base. The report still counted that row, so it told the operator to delete the live customization.

- **A served override is not counted.** The census skips a row that the one served-override predicate (`isServedOverrideRowOf`) admits, judged on the row's `package_id` column, never on a body's `_packageId`.
- **Every unserved row is still reported, with its remedies.** That includes the legacy package-less row a declared override leaves shadowed, the pair's undeclared row, a dependent package's declaration, and a package-less row whose body only names the pair. The count goes down by exactly the served rows.
- **Nothing else changes.** Which row is served, loaded or armed stays the same; only the report line changes.
