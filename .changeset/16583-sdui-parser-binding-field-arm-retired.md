---
'@objectstack/sdui-parser': minor
---

Retire the zero-writer `binding: 'field'` arm from all three of this copy's declarations, so the save gate states the same one-word vocabulary the renderer already does (#16583)

objectui retired the same arm from its copy of this package: the maintainer
ruling of 2026-09-07 on objectui#6950 (director decision batch #69) took the
serializer's input boundary, objectui#8315 took the two faces in `types.ts`,
both citing enforce-or-remove on a zero-writer measurement. That ruling names
coordinates in objectui only, and nothing propagates a retirement across the
two copies of `packages/sdui-parser` — so this one kept the arm on all three
declarations while the renderer that ships beside it no longer has it. This is
that port, measured here rather than inherited.

- `RegistryConfigLike.inputs[].binding` — now `'object'`
- `ManifestInput.binding` — now `'object'`
- `ValidationResult.bindings[].kind` — now `'object'`

**Breaking for TypeScript consumers, deliberately, and compile-time only.** A
registry config, a hand-written `Manifest` literal or a `bindings[]` entry that
spells `'field'` is now a `tsc` error. Runtime behaviour does not move: types
are erased, this package runs no validator over a `Manifest` it is handed, and
`validateTree` still forwards whatever the manifest says. A pin in
`src/__tests__/binding-field-retired.test.ts` states that limit outright, so the
narrowing is not mistaken for a runtime rejection, and it goes red in both
directions — a `@ts-expect-error` that stops being needed is itself `ts(2578)`,
so widening any of the three declarations back fails the package typecheck on
the very line that documents the retirement.

**Nothing measured has to be rewritten, and the key was never author-writable
here.** `binding` is not a spec key, has no Zod schema and no stored
representation; it reaches this package only through the structural
`RegistryConfigLike` boundary, which exists so the package can be fed
objectui's `ComponentRegistry.getAllConfigs()` without depending on it. Four
readings on this tree, each with its control: `binding: 'field'` has zero
writers in this repository against a firing `binding: 'object'` control of 2
(both under `packages/sdui-parser/src/__tests__/`); the tracked
`sdui.manifest.json` — the only manifest this repo produces — carries zero
`binding` keys across all 339 of its inputs; nothing outside the package reads
`binding` or `bindings[].kind` at all, the package's single importer
(`@objectstack/lint`'s `validate-jsx-pages.ts`) destructuring `{ diagnostics }`
only; and no arm of the vocabulary is branched on anywhere, so no consumer
loses a case it was handling.

**Why the reader face is narrowed too.** The counter-argument — producer to
reader is a subset relation, so a permissive reader is not wrong — was answered
rather than assumed away. `ManifestInput` is not a pure reader face
(`manifestFromConfigs` returns it), and `bindings[].kind` is a pure **producer**
face where the relation inverts: a wider union there accepts nothing extra, it
obliges every consumer to handle an arm this package cannot emit. The two are
coupled by `validateTree`'s `kind: input.binding` assignment, so narrowing one
alone would need a cast at the only conversion site — the lenient consumer-side
fallback Prime Directive #12 bans. The reasoning now lives on the declarations
themselves, where a later reader lands.

The reopen route is the ruling's own: a measured need for field bindings is
filed as a widening with the vocabulary decided then, not pre-declared here for
a producer that does not exist.

<!-- adr-0087: not-required (no-migration-prescription) The retired arm has no metadata surface for `objectstack migrate meta` to reach: `binding` is not a `packages/spec` key, has no Zod schema and no stored `sys_metadata` representation — it is a member of three published TypeScript interfaces in `packages/sdui-parser`, delivered to the only affected party (a TypeScript consumer) by the compiler at their own call site. There is consequently no stored shape to rewrite and no prescription to ship, which the body states rather than omits: the arm has zero writers in this repository (firing `binding: 'object'` control = 2), zero `binding` keys of any spelling in the tracked `sdui.manifest.json` (339 inputs), and zero readers outside the package. -->
