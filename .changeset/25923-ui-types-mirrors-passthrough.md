---
'@object-ui/types': patch
---

fix(types): the `@object-ui/types/zod` mirrors keep an unknown key instead of silently dropping it

Clause-②: yes
Metadata-protocol: none

- **What changed.** 145 objects in the zod mirrors were strip-mode `z.object()`: a misspelled key parsed green and vanished, so `FormFieldSchema.safeParse({ name, type, labell: 'oops' })` succeeded with `labell` gone while `@objectstack/spec` refused it by name. Every one is now `.passthrough()` (`z.looseObject`), like `BaseSchema` already was. The tolerant face keeps the key; the strict authoring face (`StrictAnyComponentSchema`, used by `objectui validate`) still refuses it by name, so the two faces disagree only on keep-or-refuse, never on silently dropping.
- **What a caller sees.** Nothing new is refused: every document that parsed before parses now. A parsed result now carries the unknown keys its input carried, and the inferred `z.input` / `z.infer` types of those objects gain zod's `[k: string]: unknown` index signature. A declared `interface` is not assignable to a type with that signature; if you assign an interface-typed value to a variable typed by one of these mirrors' `z.input`, type it through the interface or pass it to `parse()`.
- **Guard.** `zod-mirror-parity.test.ts` now fails on any strip-mode object in `ui/packages/types/src/zod/`.

What to do: nothing, unless you relied on a mirror dropping keys from its parse result; strip them yourself or read only the keys you need.
