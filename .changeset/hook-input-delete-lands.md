---
'@objectstack/objectql': minor
'@objectstack/runtime': minor
---

fix(objectql,runtime): `delete ctx.input.x` in a hook actually removes the field (#12277)

A hook that stripped a field from its input with `delete` did nothing, on BOTH
execution paths, while an assignment made two lines above it on the same object
in the same call landed normally. Nothing raised, and nothing in the platform
reported it.

Graded `minor` rather than `patch` deliberately: it moves data that reaches
downstream consumers. Any shipped hook that already contains
`delete ctx.input.<field>` has been a no-op until now and starts taking effect
on upgrade — which is the point, and is also exactly why it must not arrive as
a silent patch. No API is removed and no accept set narrows.

### The two mechanisms, which were unrelated and produced one outcome

**In-process (`installFlatInput`, `packages/objectql/src/hook-wrappers.ts`).**
The flat-record `Proxy` a declarative hook receives over the engine's
`{ data, options, id? }` wrapper trapped `get` / `set` / `has` / `ownKeys` /
`getOwnPropertyDescriptor` — but not `deleteProperty`. The delete therefore fell
through to `Reflect.deleteProperty` on the WRAPPER, one level above the record,
removing a key that was never there and returning `true`. `set` was trapped and
wrote into `data`, which is what the engine persists; hence assignment survived
and deletion evaporated.

**Sandboxed (`applyMutationsToInput`,
`packages/runtime/src/sandbox/body-runner.ts`).** A QuickJS body's mutations
were written home with `Object.assign(target, result.mutatedInput)`.
`Object.assign` copies own enumerable properties and **has no way to represent a
removal**: a key the VM deleted is simply not in the snapshot, and the host's
key stayed. Deletions are now diffed against the entry snapshot and applied
separately.

Both are fixed in one change on purpose. Closing either alone would make the
same authored `delete` behave differently depending on whether the hook body
runs in-process or in the sandbox — a worse contract than the symmetric silence
it replaced.

### What an author could see, before and after

The sandboxed path is the one with no tell at all. Measured on the pre-fix code,
one hook call, host row alongside:

```
delete ctx.input.internal_notes  ->  true
'internal_notes' in ctx.input    ->  false           <- the VM agrees
Object.keys(ctx.input)           ->  ['subject']     <- ...and so does this
host ctx.input after write-back  ->  { subject: 'HELP',
                                       internal_notes: 'STAFF-ONLY' }
```

The in-process path was less deceptive than reported, and the correction is
worth having in writing: only `delete`'s own return value lied there. `'k' in
input`, `input.k` and `Object.keys(input)` all went on honestly reporting the key
as present, so an author who checked with anything other than the return value
would have seen the no-op.

### `Object.defineProperty(ctx.input, …)` was the same gap, and nobody reported it

Found while enumerating the trap set, fixed in the same stroke because it is the
strictly worse shape: it defined on the wrapper, and the `get` trap's
fall-through then read the value straight back — so `input.k` CONFIRMED a write
that never reached `data`, while `Object.keys(input)` denied it and the record
never received it. It now routes into `data` like `set` and `deleteProperty` do.
One inherited JS invariant follows: a proxy may not report success for an
explicitly `configurable: false` descriptor its target does not carry, so
`Object.defineProperty(input, 'x', { value: 1, configurable: false })` now throws
a `TypeError` where it used to define, silently and uselessly, on the wrapper.
Omitting `configurable` — the common spelling, and the one spread and
`Object.assign` produce — is unaffected.

### The direction the sandbox write-back deliberately does not overreach in

Absence from the exit snapshot is the only evidence a deletion leaves, and on its
own it is ambiguous: a key whose host value is `undefined` (or a function, or a
symbol) never survived `JSON.stringify` INTO the VM either, so it is missing from
the dump without anyone having deleted it. The diff is filtered through the same
JSON lens the boundary uses, so such a key is left alone. Every failure mode of
that probe is conservative — an unprobeable key is simply not deletable — because
losing a delete is recoverable and destroying a field on evidence that was never
there is not. One residual miss follows and is named here rather than discovered
later: a `bigint`-valued key crosses into the VM as a string but is dropped by the
probe, so deleting one is still lost.

Measured consumer cost of the reported half: a guest-intake app stripped the
fields an anonymous web-to-case / web-to-lead submitter must not write —
internal staff notes, the resolution, the escalation flag, the owner — with
fifteen `delete` statements, every one inert. A submission carrying
`internal_notes` and `resolution` stored them verbatim, and the app's unit tests
stayed green throughout, because they drive the handler with a plain object where
`delete` genuinely works.
