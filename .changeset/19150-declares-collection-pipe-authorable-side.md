---
'@objectstack/spec': patch
---

fix(spec): `declaresCollection` reads a `pipe` on the side the author writes, so a `z.preprocess`-wrapped collection key cannot silently leave the `objectConflict: 'merge'` refusal set (#19150)

Clause-②: no

`objectCollectionKeys()` derives — never transcribes — the object-level keys `composeStacks({ objectConflict: 'merge' })` refuses to combine (#14848), and the reason it derives them is written into its own docblock: a hand-written list "would fail in the silent direction: a collection key added to the object schema tomorrow would fall back to the wholesale replacement this rule exists to refuse". The walker behind it reintroduced exactly that silent direction through the derivation itself.

`declaresCollection`'s `pipe` arm read only `def.in`. Two constructs compile to the same `pipe` node with OPPOSITE authorable sides: `a.transform(fn)` keeps the accepted input shape in `in`, while `z.preprocess(fn, schema)` puts the transform STAGE in `in` and the real, validated schema in `out`. A preprocess-wrapped collection key therefore resolved to a `transform` node, fell through to `default: return false`, and left the refusal set with nothing anywhere reporting it — the failure shape being a wholesale replacement where a refusal was owed.

The arm now reads `out` only when `in` unwraps to a transform stage, which is the rule four sibling walkers in this tree already run (`pipeAuthorableSide` in `scripts/lib/zod-graph.ts`, `kernel/metadata-authoring-lint.ts`, `system/metadata-form-zod-reconciliation.test.ts`, and `packages/lint`'s `validate-predicate-path-refs.ts`) rather than a fifth dialect.

- **`in || out` was measured and declined.** For a genuine `a.transform(fn).pipe(b)` the author writes `a`; reading either side pulls a key whose authored value is a scalar into a refusal set that then names it a collection. The landed rule leaves every `.pipe()` verdict where it was, by construction rather than by fixture choice.
- **No authored metadata changes meaning and no key changes its verdict on today's shape.** Measured over all 43 top-level keys of `ObjectSchema`: exactly one compiles to a `pipe` (`titleFormat`, an `a.transform(fn)` pipe carrying a scalar), and the derived refusal set is byte-identical under the old reading, the landed one and the declined candidate. The invariant is asserted, not claimed: `compose-stacks-collection-pipe-arm.test.ts` fails the day it stops holding.
- **`fields` keeps its exclusion by name.** It is the one collection `'merge'` merges by shallow spread, so its own reading cannot move the set either way.
