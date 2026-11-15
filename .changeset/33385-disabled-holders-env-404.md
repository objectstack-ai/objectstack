---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol,rest,runtime)!: a name only disabled packages hold answers 404 at `_env`, and an environment customization of such a name is hidden until a holder is enabled again (ADR-0150 D3, D4)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are by-name reads under a reversible package state: no stored row is changed or deleted, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a read of an environment customization of a name whose every holding package is disabled. Such a customization is a row saved without a package, for a name an installed package holds. It belongs to that package (ADR-0150 D4), and a disabled package holds no name (ADR-0150 D3).

- **The read that names no package (`GET /meta/:type/:name`, and the execution read).** When every package holding the name is disabled, this read now answers as if the customization were not saved: `404`, where it served the row. That includes a translation the package never shipped, such as an email template's `fr-FR` that only the environment wrote. A customization at a member the package ships was already hidden.
- **`GET /meta/:type/_env/:name`.** When every package holding the name is disabled, the environment address now answers `404`, as for a name no package holds, on both the REST server and the runtime dispatcher. It used to refuse `409 RESOURCE_CONFLICT` naming the disabled packages. It still refuses `409` in two cases: an enabled package holds the name, or a package holds it through a saved metadata row that the read of the name serves.

**Not moved.** With an enabled holder, every answer is unchanged. A customization of a name no installed package holds is the environment's own item and is still served.

**No migration.** Nothing is deleted or rewritten. Enable the package again and the customization is served again, unchanged. The fix for a caller who needs the row while the package is disabled is to re-enable the package.
