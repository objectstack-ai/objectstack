---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol)!: an item's lock is the strictest among the installed packages that ship its name, at the write doors and on both reads (#21803)

Clause-②: no (narrowing)

ADR-0048 lets two installed code packages ship one `(type, name)`. The ADR-0010 `_lock` gate looked the packaged artifact up with no package, so it bound the artifact of whichever package was registered first, while `getMetaItem`, `getMetaItemLayered`, the metadata list and the `getMetaDiagnostics` locked count looked it up with the request's package. One item had two lock answers, and the door's answer depended on registration order.

Now every caller takes the artifact layer from one selection: the artifact of every installed package that ships the name, a disabled package included (it is still installed). The lock is resolved once per shipping package, that package's artifact over the stored rows in scope exactly as before, and the item's lock is the strictest of those answers. With one package shipping the name, or none, nothing changes.

**What moves for consumers.** The door now refuses where it used to depend on registration order:

- one package ships a lock and another ships none: a save or delete, with or without `?package=`, is refused `403 ITEM_LOCKED` under both registration orders, where it was admitted when the unlocked package was registered first;
- one package ships no lock, the stored row in scope declares a lock, and another package ships a lock refusing the other verb (for example `no-overlay` on the row and `no-delete` on the artifact): both a save and a delete are refused, where each was admitted under the registration order that bound the other answer;
- a disabled package's packaged lock binds under both registration orders, where it bound only when that package was registered first.

No write the door refused before is admitted now: the artifact the door bound before is always one of the shipping packages. Both reads report the same lock as the door in `lock`, `editable` and `deletable`, under both orders: a read naming a package that ships no lock now reports `editable: false` when another installed package ships one. The refusal and the reads carry the prose of the binding package (the request's own package first, then the others by package id), and no prose when no single package's answer is the strictest. Content stays prefer-local: a read naming a package is still served that package's own artifact, under that package's provenance.

A served body (`getMetaItem`'s `item`, `getMetaItemLayered`'s `effective`, the list items) now carries exactly the lock family of the resolution's answer, and no `_lock` key when nothing binds. Before, a body served from a stored row outside the lock's scope kept that row's `_lock` while the envelope reported `none` (an organization holding only another package's row, with the request's package served its env-wide row), and an explicit `_lock: 'none'` stayed on a body. No key, export, status or error code changes.

<!-- adr-0087: not-required (no-migration-prescription) the write doors refuse, by the strictest lock among the installed packages that ship an item's name, writes they used to admit when an unlocked package was registered first. No authorable key, spelling, export or stored shape moves: every artifact and stored row keeps parsing, nothing is read or rewritten at rest, and which package an administrator meant to lock is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers the lock gate (not already-registered); and the change is a door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
