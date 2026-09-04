---
"@objectstack/core": patch
---

fix(core): narrow the operation-private-keys pin's scanner to `.ts`, so it judges exactly the population turbo re-runs it for (#15090)

`packages/core/src/security/operation-private-keys.pin.test.ts` filtered its
candidate set with `/\.tsx?$/` — `.ts` **and** `.tsx` — while this package's
declared radius in the cross-package declaration table is a `packages/**`
subtree glob ending in `.ts`. So the pin judged a population **strictly wider**
than the one either scoping layer of `check:cross-package-test-inputs` knows
about: Layer A never unions this package into the test shard when a `.tsx` file
changes, and Layer B never moves the `test` task's cache hash for one. A `.tsx`
file under `packages/` declaring its own `OPERATION_PRIVATE_KEY_PREFIX` or
`withoutOperationPrivateKeys` was therefore scanned by the pin and invisible to
CI's scoping — landing on `main` with every PR green and then reddening whichever
unrelated PR next touched a `.ts` file. That is the #7802 shape the declaration
table exists to close, one extension wide.

Repaired by narrowing the **scanner**, not by widening the **glob** — and that
asymmetry is measured rather than assumed. On `b548e438d`, adding a `.tsx` glob
to this package's roster entry and re-deriving `check:cross-package-test-inputs`'
watch hints flips the dispatch-gates self-test case *"nor a .tsx test file inside
it"* from true to false, with the added glob itself as the covering hint. That
case is a live specimen for "a test class the hint route cannot reach", so the
red is real and re-pointing it is a decision in another lane, not a fixup.

What the boundary costs, measured on the pin's own surface (tracked **plus**
untracked, ignored paths excluded) at `b548e438d`: **5408** `.ts` files scanned,
8 of them mentioning a guarded symbol; **8** `.tsx` files excluded, **0** of them
mentioning either symbol. The loss is empty today — and that reading is no longer
transcribed and trusted. A new case re-measures it on every run: it asserts the
excluded `.tsx` population is non-empty (so the boundary is an exclusion and not
an empty tree describing itself), that the filter really drops those files, and
that none of them declares either symbol. Ablation, with the restore proven by
blob hash rather than by exit code: re-widening the scanner reddens it while the
offender assertion stays green — which is precisely the failure mode, since a
wider scanner reads as coverage CI never runs — and planting a `.tsx`
redeclaration reddens it with a message that says the choice is a second-gate
trade, not a one-line widening.

The correspondence between scanner and glob is now stated at **both** ends: the
pin's header and the declaration table's entry for this package. No published
surface moves — the only source file edited is a test.
