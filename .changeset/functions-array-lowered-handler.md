---
"@objectstack/spec": minor
"@objectstack/runtime": patch
---

fix(spec,runtime): `functions: [{ name, handler }]` survives `objectstack build` (#6238)

The array form of the top-level `functions` collection could not pass its own
build. `lowerCallables` has lowered the array branch the whole time — it rewrites
both `handler` and `name` to the emitted ref — but the array member of the
`functions` union in `stack.zod.ts` still demanded `handler: z.function()`. So
`objectstack build` produced
`[{ name: 'syncBilling', handler: 'syncBilling', effect: 'writes' }]` and then
rejected it, with `invalid_union: Invalid input` and a path stopping at
`functions`: no entry named, no key named, no reason given.

This is the third time the same seam has parted, and the first two fixes are why
this one only looks small. #4343 taught the union the bare lowered ref; #4976
taught it the lowered *declaration*. Both only ever touched the **map** member —
the array member is a separate inline record (an array entry names itself, so it
carries `name` and an optional `packageId` and cannot be `FlowFunctionEntrySchema`
in a list), and widening one never widened the other.

**The fix.** The array member's `handler` now accepts the lowered string ref
beside the authored callable. One widening covers both array spellings at once,
unlike the map form's two separate members: `effect` is already optional on an
array entry, so the bare and the declared entry differ only in whether that key
is present. All four cells of map/array × bare/declared now round-trip.

**The load seam, which the fix made reachable.** `mergeRuntimeModule` re-attaches
each callable from the sibling ESM module to the declaration the JSON carried.
Its array branch fell through to a map rebuild — `existing` was `{}` whenever
`bundle.functions` was an array — so the merged bundle came back as a bare
`{ name: callable }` map with `effect: 'writes'` dropped on the floor. The
function still registered and still ran, and its writes were counted as none:
#4396's silent un-declaring arriving by the other door, and exactly the state
that keeps #4354's broken-sweep alert quiet on the one run that needed it. Since
the parse rejected the array form until now, no built artifact had ever reached
that branch; it is fixed in the same change rather than shipped as a live trap.
The array shape is preserved, callables are attached per entry `name`, and a
module function the artifact declared no entry for still registers — the map
branch keeps those, and the array branch must not ship fewer functions than the
bundle was built with.

Authoring is unchanged and nothing narrows: this widens what the artifact form
accepts. The map form is still the preferred spelling.
