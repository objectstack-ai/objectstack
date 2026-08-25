---
"@objectstack/metadata-protocol": patch
---

Pin the declaration emitter's module specifier for `FormFieldInput` to `@objectstack/spec/ui` (#11350). When #11350 made the three ui/automation input types nameable from `@objectstack/spec`'s root entry, tsc's declaration emitter for this package switched its synthesized reference for `FormFieldInput` from the `/ui` slice to the root entry — both portable, but the root specifier pulls spec's entire root module graph into every downstream TypeScript program that reads this package's declarations (measured: +190k types, +805k instantiations, roughly +560MB on one real program). A local type-only import binding keeps the emitted reference on the narrow `/ui` entry. Type-only and erased at runtime: every emitted JS file is byte-identical; the package's public export surface is unchanged.
