# @object-ui/test-support

Internal test-support modules shared between packages' test suites.

**This package is `private: true` and is never published.** It exists so that
two test suites in two different packages can share one implementation of
something they both need, without that shared thing becoming public API of a
released package.

## Why it exists at all

`packages/fields` and `packages/app-shell` each run a DOM-leak gate, and both
needed the same "is this attribute one HTML actually defines" judge. Neither
package can import the other's test file, so the judge was copied — and the two
copies had already drifted apart by the time objectui#4434 was filed.

The three constraints that ruled out every other home:

- both `packages/fields` and `packages/app-shell` must be able to reach it;
- it must **not** become published runtime API surface (which a `./test-support`
  subpath export on a released package would be — an entry in a published
  `exports` map is public API whatever it is named);
- no unpublished deep-subpath imports. objectui#4325 ruled that shape out after
  `@object-ui/fields/widgets/MarkdownContent` — a specifier only this repo's
  vitest alias could resolve, `TS2882` for `tsc`, and unresolvable for anyone
  outside the repo. A package's surface is its index, including this one.

A private workspace package satisfies all three at once, and costs one
`devDependency` line in each consumer.

## What may live here

Test *infrastructure* that more than one package's tests need: something both
suites must agree on, where two copies drifting apart is the real risk.

Not: fixtures for one package's own tests (those belong next to them, e.g.
`packages/components/src/__tests__/test-utils.tsx`), and not anything shipped
code imports — nothing in `src/` of a released package may import this.

## Contents

- `src/dom-leak-judge.ts` — the DOM-leak attribute judge: `isKnownAttribute`,
  `findLeaks`, `leakReport`, the happy-dom IDL gap table, the SVG presentation
  list and the open attribute families. Consumed by
  `packages/fields/src/__tests__/widget-dom-leak-e2e.test.tsx` and
  `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx`.
- `src/__tests__/dom-leak-judge.test.tsx` — the calibration fixtures that prove
  the judge, once, for both gates.
- `src/spec-tombstones.ts` — the ADR-0087 D2 tombstone judge:
  `authorableShapeKeys`, `listedShapeKeys`, `tombstonedShapeKeys`,
  `isShapeKeyTombstoned`, `tombstoneEvidence`, `shapeMemberTypeName`,
  `resolvePropsShape`. Answers "does `@objectstack/spec` still ACCEPT this key,
  or does it list a tombstone that rejects it by name?" — the question raw
  `Object.keys(schema.shape)` cannot answer, because a retired key stays in the
  shape (objectui#3809). Consumed by
  `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` (both parity
  directions), `packages/plugin-detail/src/__tests__/recordDetailsInputs.spec-parity.test.ts`
  and `packages/app-shell/src/views/metadata-admin/previews/__tests__/block-config.test.ts`
  (the last two converged off local structural-only copies by objectui#4947).
  No copy of the judgement is left in-tree: gates import this module, they do
  not write the criterion out again.
- `src/spec-enum-options.ts` — the spec enum-vocabulary reader. **Two exports,
  ONE wrapper walk**: `enumOptions(node)` is the walk, and
  `shapeEnumOptions(schema, key)` is the same walk entered through
  `resolvePropsShape`. Both answer "which names does this contract accept?" —
  the question spec-parity suites used to answer with a hand-written cast into
  Zod internals.
  - `shapeEnumOptions(schema, key)` — for an enum that sits INSIDE an object
    schema, behind a wrapper. Replaced four byte-for-byte identical walks into
    `def.innerType` (objectui#5872). Consumed by
    `packages/components/src/__tests__/data-table-selection-mode.test.tsx`,
    `packages/plugin-list/src/__tests__/add-record-position-spec-parity.test.tsx`,
    `packages/plugin-list/src/__tests__/user-filter-arity-spec-parity.test.tsx`
    and `packages/plugin-timeline/src/__tests__/timeline-scale-spec-parity.test.ts`.
  - `enumOptions(node)` — for a node that IS the enum: a top-level `z.enum`
    imported straight from `@objectstack/spec`, or a shape member the caller
    already holds. Replaced 17 hand-written
    `(Schema as { options?: readonly string[] }).options` casts across 16 files
    in 11 workspace packages (objectui#6924) — a larger family than #5872's,
    with the same quiet-permissive failure. It is an ENTRY POINT onto the walk
    above, not a second reader: `shapeEnumOptions` delegates to it, so there is
    exactly one wrapper walk in this repository and a third entry point must not
    change that.
  - Of the other Zod-internals reader classes #5872 censused, the wrapper-key
    list is now shared as DATA (below, objectui#6923) and array-element
    unwrapping is `src/spec-array-element.ts` (below). What is still hand-copied
    are the readers that ask a DIFFERENT question — union arms, walk-until-a-
    shape-is-reachable, and the deliberately one-level-deep reads that carry
    their reason in a comment. Those are not copies of these walks and must not
    be swept onto them.
- `src/spec-zod-wrappers.ts` — THE wrapper walk, `firstInWrapperChain`, and the
  `MAX_WRAPPER_DEPTH` bound. Not exported from the package index: it is plumbing
  between the two readers below, not something a gate should hold. It exists
  because a second reader class arrived that needed the same steps with a
  different question asked at each one, and writing that walk out again inside
  the new reader would have been this package's own failure mode reintroduced by
  the package that exists to end it.
- `src/spec-array-element.ts` — the array-element reader, `arrayElementSchema`
  (objectui#5872 class (2)). Answers "what shape does ONE entry of this array
  have?", past `.optional()` / `.default()` / `.nullable()` / `.readonly()` /
  `z.lazy()`, and `undefined` when the node is not an array. Unlike class (1)'s
  four byte-identical copies, this class's three copies DISAGREED — about
  whether to walk at all, which `def` spelling to read, and whether a non-array
  answers `undefined` — so the module records which site each choice came from
  and what was measured before it was made. Consumed by
  `packages/plugin-detail/src/__tests__/recordDetailsInputs.spec-parity.test.ts`,
  `packages/app-shell/src/views/metadata-admin/previews/__tests__/block-config.test.ts`
  and `packages/app-shell/src/views/metadata-admin/clientValidation.optOuts.test.ts`.
- `src/zod-wrapper-keys.json` + `src/zod-wrapper-keys.ts` — the Zod wrapper-key
  vocabulary, exported as `ZOD_WRAPPER_KEYS` (objectui#6923, ruled 2026-08-31 —
  objectui#5872 class (3)). The `.json` holds the data and the `.ts` holds the
  reasoning; read the `.ts` header before touching either.

  This is the one class whose copies had grown OUT of tests and into `.mjs` CI
  gate scripts, so the class-(1) pattern above was unavailable across it: this
  package's `exports["."]` is TypeScript source and a bare
  `node scripts/check-*.mjs` has no build artefact to reach. The ruling gave the
  DATA a build-free home and a subpath of its own, and drew a boundary around
  it — **the walks stay with their callers**. They are not identical
  (`check-designer-field-key-parity.mjs` reads `node._def ?? node.def ??
  node._zod?.def`; `check-action-forward-parity.mjs` reads `s._def ?? s.def`),
  and sharing a FUNCTION across the language boundary is explicitly outside that
  ruling. Consumed by those two gates plus
  `packages/core/src/actions/__tests__/actionKeys.pin.test.ts`,
  `packages/app-shell/src/views/metadata-admin/inspectors/flow-node-config.spec-reconciliation.test.ts`
  and `packages/app-shell/src/views/metadata-admin/previews/flow-canvas-seeds.spec-parse.test.tsx`.
  No copy of the list is left in-tree.
- `src/__tests__/zod-wrapper-keys.test.ts` — the surface half: the module is the
  JSON verbatim, it is non-empty, and it reaches consumers through the package
  index rather than a deep path. The half that carries the discrimination is
  `scripts/__tests__/zod-wrapper-keys.shared.test.ts`, which drives one fixture
  per key through **both** `.mjs` gates' real entry points, so emptying the list
  — or dropping a single entry — turns them red instead of quietly permissive.
- `src/__tests__/spec-enum-options.test.ts` — the calibration for that reader:
  one synthetic fixture per wrapper spelling it claims to walk (bare enum,
  `.optional()`, `.default()`, a stack, and a `lazySchema()` thunk), the `[]`
  cases that keep a consuming suite's non-vacuity assertion from being a rubber
  stamp, a non-empty check against the four real `@objectstack/spec` pairs, and
  the same three halves again for `enumOptions` — including the pin that the two
  entry points agree, which is what makes the delegation observable.
- `src/__tests__/spec-array-element.test.ts` — the calibration for the
  array-element reader: one synthetic fixture per wrapper spelling it walks, the
  `undefined` cases that keep a consuming suite's `toBeDefined()` from being a
  rubber stamp, the three choices made between the disagreeing copies pinned one
  by one (including that Zod 4's `_def.type` STRING is never returned as a
  schema), and the non-empty check against the real `RecordDetailsProps.sections`.
- `src/__tests__/spec-tombstones.test.ts` — the calibration for that judge: one
  synthetic fixture per recognition channel (so neither can quietly stop
  working), plus a cross-check of the structural verdict against what the
  installed contract's own `safeParse` actually rejects.

## Conventions

- Consumers add `"@object-ui/test-support": "workspace:*"` to
  **`devDependencies`** — never `dependencies`, since no consumer ships it.
- Import the package root (`@object-ui/test-support`), never a deep path. The
  single exception is `@object-ui/test-support/zod-wrapper-keys`, a declared
  `exports` subpath pointing straight at a `.json` file. It exists because a
  bare-node CI gate has no other way in, it carries DATA only, and it was ruled
  (objectui#6923) rather than assumed. It does not license a second one — a
  TypeScript consumer has the package root and must use it.
- There is no build: consumers resolve the TypeScript source through the
  `exports` map. `pnpm --filter @object-ui/test-support type-check` reads both
  the modules and their tests in one program.
- The workspace ROOT declares this package too, so that `node scripts/*.mjs`
  can resolve the subpath above from `scripts/`. That root entry is what makes
  the bare specifier work; a gate importing it without it fails at module load.
