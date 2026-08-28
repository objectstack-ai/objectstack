---
"@objectstack/spec": patch
---

fix(spec): `ObjectSchema.create()` rejects unknown keys on nested action-param literals at compile time (#12615)

`create()` infers its generic from the argument, so TypeScript's
excess-property (freshness) checking never fires at any depth; the existing
`NoExcessObjectKeys` map compensated only at the top level. A typo'd key on an
`actions[].params[]` literal (measured: `carryOverX` on
`sys-permission-set.object.ts`) therefore passed `tsc` clean and was caught
only by `ActionParamSchema`'s strict parse at module load.

The same `Record<excess-key, never>` map is now mirrored over each element of
each action's `params` array, so the typo becomes a located `tsc` error at the
authoring site (`error TS2322 … 'true' is not assignable to 'never'` pointing
at the unknown key).

Compile-layer signal only — shipped as `patch` because no working code
changes meaning: the strict parse at module load stays the enforcement of
record, nothing changes in what parses or when, and every literal the new
constraint refuses was already refused (later, at import) by that parse.
