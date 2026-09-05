---
"@objectstack/trigger-record-change": patch
---

fix(trigger-record-change)!: the record handed to a record-change flow no longer aliases the write's payload (#14744)

<!-- adr-0087: not-required (no-migration-prescription) Nothing metadata-shaped moves: no spec key, no Zod schema, no `packages/spec` declaration, no export, no config field and no stored row changes spelling or shape, and a stored flow definition is byte-identical before and after — `objectstack migrate meta` has nothing to reach. What moves is the reference identity of the object one runtime seam hands a flow. The consumer note below names the supported node for writing a record; it prescribes no rewrite of any authored artifact, and the code it could affect is a stack author's own registered function body, which the metadata upgrader cannot see. -->

**BREAKING** for a flow whose `script` node mutates a NESTED value of the
triggering record IN PLACE: that mutation no longer affects the write the flow
was triggered by. Shipped as `patch` — this change moves no public surface (no
exported symbol, no accepted key or value), and under the maintainer's
2026-09-04 rule (decision batch #35, on #15294) a `fix(` that changes no public
surface stays `patch`, with breaking-ness carried by this banner and the
ADR-0087 disposition rather than by the level. Maintainer ruling 2026-09-04 on
#14744 (decision batch #38, verbatim 「同意」), adopting option A.

**Why.** `buildContext` builds the flow's `record` as a shallow overlay of the
pre-image, the mutation payload and the after-row. The top-level object was
new, so a flow ASSIGNING a top-level key reached nothing — but every nested
value in it was the engine's own object, shared by reference. One of those is
`ctx.input.data`, and on a `multi: true` update ADR-0058 Addendum II D3 hands
every per-row context that same payload object, which is the SET clause of the
single `updateMany`. A registered function doing `record.tags.push(...)`
therefore wrote the SET clause without assigning any key: every dispatch's
contribution landed on EVERY matched row, including values derived from another
row's pre-image, and #14099's key-set refusal could not see it because no key
was assigned. Measured end to end on the memory driver and on
`@objectstack/driver-sql` (#15356).

**What changes.** Both flow-facing roots — `record` (and the `params` alias of
it) and `previous` — are decoupled from the engine's state before the flow
runs. Arrays, plain objects, `Date`, `RegExp`, `Map` and `Set` are copied;
primitives, functions and other class instances are shared, which is the
documented and pinned boundary. A flow still mutates its roots freely and still
observes its own writes for the rest of the run; those writes simply reach
nothing outside it. `previous` is decoupled in the same stroke because it is the
engine's single pre-image object and the same hook context reaches every other
flow bound to the same write.

**What does NOT change.** The engine's write shape. ADR-0058 Addendum II D3
stands untouched: one payload still serves N rows and every per-row context is
still handed that one object. #14099's key-set refusal is untouched and is not
widened — a hook that assigns the same key with per-row values still passes it,
and divergent key sets are still refused whole. Flow metadata with no registered
function reached nothing before this change and reaches nothing after it:
assignment nodes write the run's variable map, and `update_record` issues its own
by-id write. Lookup expansion (`config.expand`) still grafts onto the record the
flow holds.

**Consumer note.** A flow that relied on an in-place nested mutation to persist
— which on a by-id write did persist, and on a `multi: true` write corrupted
every other matched row — writes the record with the `update_record` node
instead. That node is the supported per-row write and is unaffected by this
change.
