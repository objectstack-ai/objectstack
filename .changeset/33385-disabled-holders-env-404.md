---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol,rest,runtime)!: a name only disabled packages hold answers 404 at `_env`, and an environment customization of such a name is hidden until a holder is enabled again (ADR-0150 D3, D4)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: updated here — content/docs/data-modeling/import-mappings.mdx (no `skills/**` file teaches an `_env` answer)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are by-name reads under a reversible package state: no stored row is changed or deleted, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a read of an environment customization of a name whose every holding package is disabled. Such a customization is a row saved without a package, for a name an installed package holds. It belongs to that package (ADR-0150 D4), and a disabled package holds no name (ADR-0150 D3).

- **The read that names no package (`GET /meta/:type/:name`, and the execution read).** When every package holding the name is disabled, this read now answers as if the customization were not saved: `404`, where it served the row. That includes a translation the package never shipped, such as an email template's `fr-FR` that only the environment wrote. A customization at a member the package ships was already hidden.
- **The list and the execution list (`GET /meta/:type`).** They now leave out the same customization, so they agree with the read of the name: while every package holding the name is disabled, neither list carries any item of it. Enable a holder again and both list it again.
- **A save or delete naming no package while every holder is disabled.** A save at a member the package never ships is accepted and kept, as before, but it is now hidden from the reads above until a holder is enabled again. A delete of it still removes the row. A save at a member the package ships is still refused `403 NOT_OVERRIDABLE`.
- **`GET /meta/:type/_env/:name`.** When every package holding the name is disabled, the environment address now answers `404`, as for a name no package holds, on both the REST server and the runtime dispatcher. It used to refuse `409 RESOURCE_CONFLICT` naming the disabled packages. It still refuses `409` in three cases: an enabled package holds the name; a package holds it through a saved metadata row that the read of the name serves; or the read carries `?state=draft`, `?preview=draft` or `?layers=`, which read other rows than the plain read. That `409` names only the disabled package the registry holds the name for, as before; it does not name an enabled package that holds the name through a saved row.
- **The import door's `mappingName: "_env/NAME"`.** The same move, as `GET /meta/mapping/_env/NAME` answers it: `404 MAPPING_NOT_FOUND`, naming no package, where it was refused `409` naming the disabled package.

**Not moved.** With an enabled holder, every answer is unchanged. That includes an enabled package that holds the name only through a saved row the registry has not read yet: the customization is still served and listed, whether the list or the read of the name comes first. A customization of a name no installed package holds is the environment's own item and is still served.

**No migration.** Nothing is deleted or rewritten. Enable the package again and the customization is served again, unchanged. The fix for a caller who needs the row while the package is disabled is to re-enable the package.
