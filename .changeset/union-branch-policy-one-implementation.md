---
"@objectstack/spec": patch
---

refactor(spec): the union-branch selection policy has ONE implementation, and a parity test that keeps it that way (#8318)

`shared/error-map.zod.ts` (the prose renderer, #4971/#5389) and
`api/zod-issues-to-fields.ts` (the ADR-0114 D3 wire mapper, #8124) carried the
SAME union-branch selection policy as two separate implementations —
kind-mismatch drop, fewest-issues ranking, `unrecognized_keys` tie-break,
declaration-order determinism, depth limit 3, branch cap 3, and the
`invalid_key` / `invalid_element` container codes. While the mapper still lived
in `@objectstack/rest` the duplication was forced; #8124 moved it into this
package, so the two sat one directory apart with their module headers — and
nothing mechanical — asking whoever edits one to edit the other.

The policy now lives in one package-internal module,
`src/shared/union-branch-policy.ts`, which both walks import. It is deliberately
NOT a public export: it is absent from every barrel, and `api-surface/` and
`export-origins/` do not move.

The two WALKS stay separate implementations, as they should — one renders
indented `✗ path: message` prose for a terminal, the other produces
`{field, code, message}` entries for a JSON envelope, and only the renderer
emits the trailing "… and N more branches rejected this value" line. That
asymmetry is now explicit rather than implicit: `selectUnionBranches` returns
`{selected, omitted}`, the renderer prints `omitted`, and the mapper
destructures `selected` alone at a commented line, because a `fields[]` entry
must name a real field and carry a catalog code and an omission count has
neither.

`src/shared/union-branch-policy.parity.test.ts` is the enforcement the module
headers lacked: one `safeParse` per fixture feeds BOTH walks, and their outputs
are compared pair for pair after a normalisation that removes the indent, the
`✗` glyph and the `(root)` spelling — nothing else. The corpus covers every rule
of the policy (kind-mismatch drop, all-kind-mismatch, fewest-issues ranking, the
`unrecognized_keys` tie-break, declaration-order determinism, the depth limit,
the branch cap, and container descent for both `invalid_key` and
`invalid_element`), and the one deliberate asymmetry is asserted rather than
normalised away.

Behaviour is unchanged for every issue zod produces: the ranking, both limits
and the container-code set are byte-identical to what each walk applied before.
The single deliberate widening is that the shared policy reads a missing or
non-array `path` as the root — the wire mapper's already-shipped normalisation,
now applied to the renderer too, which previously threw on such an issue object.
No value satisfying the renderer's own `ZodIssueMinimal` type is affected.
