---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide names what each package's address and list entry answer when two packages ship one name and one declares its `.custom` override: that package's own item, in either registration order (ADR-0150 D4)

Clause-②: no
Metadata-protocol: none

The semantic entry `two-shipper-declared-override-own-slot` (`packages/spec/src/migrations/entries/semantic/18.two-shipper-declared-override-own-slot.ts`) registers the change `.changeset/33131-two-shipper-override-own-slot.md` declares (ADR-0087, `adr-0087: registered`): no automatic rewrite, since every stored row keeps its shape and its binding. It adds no key and no export.
