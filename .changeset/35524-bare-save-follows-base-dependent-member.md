---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a save naming no package, at a bundle member only a dependent package holds, writes the base package's row the read naming no package addresses

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is which stored row a save, draft read, per-item publish or draft discard that names no package addresses at one cell; no stored row, registry key or authored value is rewritten, so there is nothing for a migration to change and no tombstone. -->

**BREAKING** for a caller that saves, publishes or discards a bundled type's item (today `email_template`) without naming a package, where an authored base package holds a stored row of the item at some member (its canonical member, or another one such as `de-DE`), an authored package that declares the base holds a stored row of another, non-canonical member (for example `fr-FR`), and the base holds no row of that member. The read naming no package already takes the base's address at that member and answers `404`.

- FROM: the save naming no package (REST `PUT` and in process, `active` mode) rewrote the dependent's row at that member, and the read naming no package then still answered `404` (or `409 RESOURCE_CONFLICT` where the rows had been stored after boot). The `draft` save wrote the dependent's draft; the draft read, per-item publish and draft discard naming no package read, promoted or removed the dependent's draft.
- TO: the save naming no package writes the base's row (or, in `draft` mode, the base's draft) at that member, exactly as the same save naming the base (`?package=BASE`, `packageId: BASE`) does; the dependent's row is left byte-unchanged, and the next read naming no package serves the saved content (`200`). The draft read, per-item publish and draft discard naming no package act on the base's draft there. With only the dependent's draft stored at that member, the per-item publish naming no package answers `404 NO_DRAFT` naming that draft, and the draft discard naming no package discards nothing and says which draft remains, as the same requests naming the base answer.
- FROM, a package-unbound draft stored at that member (as a `draft` save naming no package writes it while no package holds the member) with no draft of the dependent beside it: the draft read naming no package served that draft, the per-item publish naming no package promoted it into the dependent's row, the draft discard naming no package removed it, and the `draft` save naming no package adopted it into the dependent's draft, after which the draft doors naming no package still acted on it.
- TO, at that sub-cell: the `draft` save naming no package writes the base's draft beside the package-unbound one and leaves the package-unbound draft untouched, as the save naming the base does; the draft read naming no package then reads back what was saved; the per-item publish naming no package promotes the base's draft into the base's row; a second `draft` save naming no package updates the base's draft (no second draft). With no base draft stored, the per-item publish naming no package answers `404 NO_DRAFT` and the draft discard naming no package discards nothing and names the package-unbound draft as still stored, exactly as the same requests naming the base answer. With no base draft stored, the draft read naming no package still serves the package-unbound draft, as the draft read naming the base does; once the base's draft is saved, both read the base's draft.

**Not moved.** The canonical member (a base and its dependent both holding it, or only the dependent holding it), two packages neither of which declares the other, a base that ships the name in code, and the delete, history, diff and rollback naming no package at this member.

The fix for a caller: to change the dependent's row or draft at that member, name the dependent (`?package=DEPENDENT` on the REST door, `packageId` in process).
