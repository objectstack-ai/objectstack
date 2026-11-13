---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide names the two exact reads #32561 narrows: an undeclared row of an App's customization pair is no member of a package's address when the registry binds it to no package, because another package of the App ships its locale as a bundle addition or another App's shared pair stores an undeclared row of the name

Clause-②: no
Metadata-protocol: none

The semantic entry `pair-row-exact-read-no-owner` (`packages/spec/src/migrations/entries/semantic/18.pair-row-exact-read-no-owner.ts`) registers the narrowing `.changeset/32561-exact-read-adopts-pair-row-binding.md` declares (ADR-0087, `adr-0087: registered`). There is no automatic rewrite, because which package's locale a pair row customizes is a judgement about that row. The remedy it names is the one the save door accepts: declare the package that ships the locale (`overrides.package`). It adds no key and no export.
