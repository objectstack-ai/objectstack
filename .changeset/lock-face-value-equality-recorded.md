---
'@objectstack/objectql': patch
---

Record the deliberate asymmetry between the two hook-vs-caller seams, and pin both faces

`stripReadonlyFields` (#14088) and its insert-side twin `stripRuntimeOwnedFields` (#14472)
decide "hook write or caller forgery?" from a RECORD of the keys the before-phase hook
chain assigned. `isCallerSuppliedValue`, behind `stripReadonlyWhen{Fields,FieldsMulti}`,
stays on VALUE EQUALITY. That divergence is now a ruled, documented decision instead of a
docblock claiming the two tests are identical.

Why the faces differ: the static face guards an author-declared `readonly` or a
runtime-owned column, where hook authorship *is* the exemption on offer — so "an
assignment ran" is the right evidence, and the record's blindness to the value is what
makes it correct. The lock face guards a `readonlyWhen` STATE lock, whose whole guarantee
is that no caller write survives a TRUE predicate; there, the same blindness would let a
line spelled `data.x = data.x` — or a normalisation that is the identity for canonical
input — hand the caller's own value hook ownership and silently unlock the lock.

No behaviour changes. On a `readonlyWhen` lock, a before-phase assignment that writes back
the value already on the key is still not a hook write: the caller's value is stripped,
with the same warning and the same `onFieldsDropped` / `strictReadonlyWrites` reporting.
The accepted residual — a hook that genuinely derives a locked field loses its write when
the caller echoed the identical value — is stated in the code rather than left to be
rediscovered; no instance of it exists in the tree.

Each face now carries a measurement pin, written to be read side by side: `MEASURED: a
lone self-assigning hook leaves the CALLER value on the key` on the static face, and
`LOCK 3b` on the lock face, pinning the opposite verdict for the identical hook spelling.
