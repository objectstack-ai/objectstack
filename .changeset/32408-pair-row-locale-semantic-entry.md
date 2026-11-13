---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide names the two registrations #32408 narrows: a package whose only locales of an email template are ones the App ships none of, while the App's customization pair stores a row of that locale declaring another package of the App, is refused naming the App as an addition to the App's template; and a package of another namespace on a package X that holds the template alone (or that X's dependencies reach), whose only locales of it are ones X ships none of, while a package-less row of that locale customizes X's template, is refused naming X as an addition to X's template (#32408)

Clause-②: no
Metadata-protocol: none

The semantic entry `pair-row-locale-addition-refused` (`packages/spec/src/migrations/entries/semantic/18.pair-row-locale-addition-refused.ts`) registers the narrowing `.changeset/32408-pair-row-binding-every-reader.md` declares (ADR-0087, `adr-0087: registered`): no automatic rewrite, because which locale a package ships and which base a pair row customizes are judgements about that package and that row. It adds no key and no export.
