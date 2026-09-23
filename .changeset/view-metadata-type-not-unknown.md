---
'@objectstack/spec': minor
---

fix(spec): the published type `ViewMetadata` names a `view` body instead of being `unknown` (#19871)

Clause-②: no (narrowing)

**BREAKING for TypeScript code that annotates with `ViewMetadata`**: a narrowing of a published
TYPE, landing in the launch window as `minor` (the lockstep convention: the bump level is not the
carrier, this banner and the disposition below are). The runtime accept set does not move at all:
`ViewMetadataSchema` is unchanged, and a 44-body parse probe answers byte-identically before and
after.

`ViewMetadata` was declared as `z.input<typeof ViewMetadataSchema>`. That schema is a
`z.preprocess`, whose input type is `unknown`, so the name documented as "any persisted view
metadata body: container | ViewItem record | flattened overlay" type-checked any value at all,
including bodies the schema refuses. It is now the union of the input types of
`VIEW_METADATA_MEMBERS`, the four members the schema's union runs, so `unknown`, a non-object and a
key no member declares are compile errors, and a body of each member still type-checks.

**What still differs from the runtime verdict.** The type is the members' declared shape, not the
door's answer. The door still accepts bodies the type refuses (it removes the console's row `id`s
and three members strip undeclared keys), and still refuses bodies the type admits (the identity
precondition, the members' refinements, and a body mixing keys of different members, which
TypeScript checks against the union as a whole). `ViewMetadataSchema.safeParse` remains the only
judge.

**If your code stops compiling.** A value you annotated as `ViewMetadata` is not one of the four
member shapes. Correct the body, or type a value that is still unvalidated as `unknown` and let
`ViewMetadataSchema.safeParse` decide.

`ViewMetadataParsed` is not changed by this release: it is still `unknown`.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or re-typed at runtime: no spec key, no export, no stored row moves, and every view body parses byte-identically, so `objectstack migrate meta` has nothing to reach. The only thing that moved is a TypeScript annotation, whose channel is the consumer's compiler. `type-surface-only` does not apply because this diff touches `packages/spec/**` (its predicate 2). -->
