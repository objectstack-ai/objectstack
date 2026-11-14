---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide names what a holder's registry item answers when a stored row of its name is bound to a package that holds none of it, or to a customization pair, while two packages hold the name: its own item or its override (ADR-0150 D4)

Clause-②: no
Metadata-protocol: none

The semantic entry `stored-row-of-a-non-holder-under-two-holders` (`packages/spec/src/migrations/entries/semantic/18.stored-row-of-a-non-holder-under-two-holders.ts`) registers the narrowing `.changeset/32692-stored-row-names-no-holder.md` declares (ADR-0087, `adr-0087: registered`): no automatic rewrite, because which holder a stray row customizes is a judgement only its author can make. It adds no key and no export.
