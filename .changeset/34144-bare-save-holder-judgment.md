---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a bare save or delete answers the holders the bare read counts: a name two enabled packages hold is refused naming both, and a name only disabled packages hold is refused naming none (ADR-0150 D3/D5)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are write doors under a reversible package state: no stored row is rewritten, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a writer that saves or deletes a name without naming a package (`PUT` or `DELETE /meta/:type/:name` with no `?package=`, or `saveMetaItem` / `deleteMetaItem` with no `packageId`), in two states. The bare write used to take its address from the stored rows alone, while the bare read counts the name's holders. It now counts them as the read does (ADR-0150 D3/D5, red line 2: ambiguity is reported, never guessed). Every refusal is the existing `409 RESOURCE_CONFLICT` with the `?package=` remedy; there is no new code. Measured on a booted kernel through the runtime dispatcher and `RestServer`, in both registration orders.

**Two or more enabled packages hold the name.** The bare read refuses 409 naming them.

- A publish-mode bare save used to answer 200. Over no stored row it wrote a package-unbound row beside both packages; over one package's row it updated that row. It is now refused naming both packages, and nothing is written. Over a row of each it was refused already, and still is.
- A draft-mode bare save (`?mode=draft`) used to write a package-unbound draft, or the one package's draft. It is now refused the same way.
- A bare delete used to remove the one package's row. It is now refused the same way, and the row stays.

**Every package that holds the name is disabled.** A disabled package holds no name (ADR-0150 D3), so the bare read answers 404. The bare write is now refused naming no package (ruling A):

- A publish-mode bare save of a name whose only holder D is disabled used to answer 200. Over D's row alone it updated D's row; over no stored row it wrote a package-unbound row that every read then withheld. It is now refused, and nothing is written.
- A bare save of a bundled name (an `email_template`) whose every holder is disabled, at a member the holder never ships, used to answer 200 and store a package-unbound row that the by-name read and both lists withheld until the package was enabled again. It is now refused, and nothing is stored. This replaces the "accepted and kept" save described in this release's note on reads of a disabled package's customization: FROM `success: true` with the row stored and hidden, TO `409 RESOURCE_CONFLICT` with the `?package=` remedy, naming no package, no row stored. A delete of such a row while the package is disabled still removes it, a save at a member the package ships is still refused `403 NOT_OVERRIDABLE`, and once the package is enabled again the same save is kept.
- A draft-mode bare save (`?mode=draft`) of such a name used to write a package-unbound draft. It is now refused the same way.
- A bare delete of such a name used to remove D's row. It is now refused, and D's row stays.

**Not moved.** A write naming the package (`?package=`, `packageId`) answers as before. So do a name one enabled package holds, a name an enabled and a disabled package both hold, a name no package holds (the environment's own item), and a package-unbound row stored at the address: the save edits that row and the delete removes it, as before. Once a disabled package is enabled again, its bare writes answer as before.

**No migration.** No schema key or stored row changes. To write one holder's item, name its package; to write a disabled package's item, name it or enable it again.
