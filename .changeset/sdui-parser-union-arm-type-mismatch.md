---
'@objectstack/sdui-parser': minor
---

html tier: a union-typed manifest input is now coarse-type-checked over every declared arm instead of drawing no diagnostic at all

`ManifestInput.type` now carries ONE coarse kind, or an ARRAY of kinds when the
key's contract is a union (objectui#3832). Before this change, this copy's
`checkType` was the older single-arm `switch (input.type)`: a manifest input
declaring a union fell through `default: return null` and drew **no diagnostic
at all** — silence indistinguishable from a value that validated cleanly —
while objectui's copy checked every arm. The same authored page produced
diagnostics on one surface and none on the other: the dialect split the two
parser copies' invariant forbids (objectstack#12719 — both copies agree on the
accepted grammar **and** on diagnostic codes).

`validateTree`'s coarse check now clears a prop when **any** declared arm
accepts the value, and when **no** arm accepts it emits **one** `type-mismatch`
diagnostic naming every arm — at `error` severity when an `enum` arm is
present (an enum's closed list is the one fact this layer can be certain
about), `warning` otherwise. A single-arm input produces the byte-identical
diagnostic it always did, `invalid-enum` included. `generateDts` emits a
TypeScript union for a union declaration, and `manifestFromConfigs`
canonicalizes union declarations through the new `input-type.ts` module
(`inputTypeArms`, `canonicalizeInputType`, `MANIFEST_INPUT_TYPES` — all
exported, so third-party manifest consumers read arms through the same
accessor the gate does).

This is the lockstep port of the objectui#3832 ruling into this repo's hoisted
copy of the parser — the ported check is byte-equal to objectui's. It changes
what the save gate accepts and rejects for union-typed inputs: a value fitting
no arm of an enum-carrying union now draws an `error` where it previously drew
nothing. Today that change is latent in the production gate — this repo
resolves no `sdui.manifest.json`, so `validateJsxPages` runs parse-only; wiring
the manifest (the second gap recorded on objectstack#12719) is what makes it
author-visible, and this port lands ahead of that wiring deliberately.
