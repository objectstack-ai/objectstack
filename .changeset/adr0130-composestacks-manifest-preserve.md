---
"@objectstack/spec": minor
---

feat(spec): `composeStacks` gains `manifest: 'preserve'` — N package identities survive composition (ADR-0130 row 3, #14164)

`composeStacks`' `manifest` option accepts a fourth value, `'preserve'`. Instead
of keeping one manifest and discarding the rest, it folds **every** input's
package identity into the composed artifact's `packages` list (ADR-0130 D4), in
stack order.

**Why the existing values could not simply be fixed.** `'first' | 'last' |
<index>` is a deliberate **pick-one**, and it is correct for the case it was
written for: several stacks assembled into ONE published package, which has one
identity. ADR-0130 introduces the other case — a release artifact that *carries*
N packages, each keeping its own identity, so a product splits into modules
**without renaming a single object** (the object `name` IS the table name, the
REST path, the formula token and the saved-view key, ADR-0129 D1–D2). Composing
N stacks under a pick strategy loses N−1 package identities, which is the
lossiness ADR-0130 §5 rejects `composeStacks`-as-is for. Both cases are real, so
the mode is a new value rather than a change of meaning for the old ones.

**Which entries a stack contributes is D4's read-both rule, applied to the
inputs** — the same rule the load path applies to an artifact, so composition
and loading cannot disagree about what "the packages of this stack" means:

- stack declares `packages` → those entries;
- stack declares no `packages` → its singular `manifest` as a **single-element
  list**.

A stack carrying both therefore contributes its list once, not its list plus its
manifest — nothing is emitted twice in the first place, so no de-duplication
pass exists to get wrong later.

**Every emitted element is the `{ manifest: … }` wrapper object**, judged by
`ArtifactPackageEntrySchema` itself rather than by a re-derived literal — a
second declaration of one shape is the drift ADR-0116 exists about, and that
wrapper is the structural position ADR-0130 D4 reserves so a future
`{ ref, integrity }` external segment stays an **additive key** rather than a
reshape.

**`'preserve'` is additive over the default, not a fourth pick.** The singular
`manifest` is still selected, by the same `'last'` rule, so a preserve
composition's output is the default's output **plus** the package list: the
artifact keeps an artifact-level identity (ADR-0130 D6 — one artifact, one
version) and no consumer reading `composed.manifest` sees a key disappear.
Nothing is registered twice either — D4's read-both rule reads a
`packages`-carrying artifact through `packages`, and `manifest` is the fallback
branch for artifacts that have none.

**Graded `minor`: a pure widening.** The accept set gained exactly one option
value; the default is still `'last'`, no existing value changed meaning, and
nothing that parsed before is refused now. Existing callers — every caller that
passes no `manifest` option, and every caller that passes `'first'`, `'last'` or
an index — are unaffected, and that half is a machine criterion rather than a
reading of the diff (ADR-0130 D7: "Reviewer attention is not a mechanism"). It
is pinned in `packages/spec/src/compose-stacks-manifest-preserve.test.ts`
against the output of each existing strategy, **including the negative half**:
none of them mints a `packages` key. The pin #14161 deliberately left in
`stack-artifact-packages.test.ts` — "leaves the singular `manifest` pick-one
semantics alone" — is retitled `… BY DEFAULT` and keeps its assertions
unchanged, because that is precisely what this card did not touch.

⚠️ This ships **composition** only. The load path that iterates `packages` in
dependency-topological order (D5, through the one sorter `resolvePluginOrder`)
and the `installPackage` co-ownership gate (D1/D3) are separate, dependent
cards. Until they land, a preserved artifact carries N package identities and
nothing downstream iterates them — so composing with `'preserve'` today
registers no extra package.
