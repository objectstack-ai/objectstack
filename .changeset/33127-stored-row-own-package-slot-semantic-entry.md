---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide names what each package's address answers when two packages each hold a stored row of one name: that package's own row, in every save order, before and after a restart (ADR-0150 D3/D4)

Clause-②: no
Metadata-protocol: none

The semantic entry `stored-row-own-package-slot` (`packages/spec/src/migrations/entries/semantic/18.stored-row-own-package-slot.ts`) registers the narrowing `.changeset/33127-stored-row-own-package-slot.md` declares (ADR-0087, `adr-0087: registered`): no automatic rewrite, since every stored row keeps its shape and its binding. It adds no key and no export.
