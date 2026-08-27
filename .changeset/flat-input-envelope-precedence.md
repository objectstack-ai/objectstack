---
"@objectstack/objectql": patch
---

fix(objectql): the flat-input Proxy's descriptor trap agrees with `get` about the four reserved names (#12601)

`installFlatInput` gives `id` / `options` / `ast` / `data` precedence in the
`get` trap — a direct read (`ctx.input.id`) always resolves against the
engine's `{ data, options, id? }` wrapper (the envelope), never against the
record payload, even when the payload itself declares a field sharing one of
those names. `getOwnPropertyDescriptor` checked the payload FIRST instead, so
for an update whose payload happened to carry a same-named field:

```js
const raw = { data: { id: 'PAYLOAD-ID', subject: 'help' }, options: {}, id: 'WRAPPER-ID' };
ctx.input.id                                             // 'WRAPPER-ID'  (get)
Object.getOwnPropertyDescriptor(ctx.input, 'id').value    // 'PAYLOAD-ID'  (descriptor, pre-fix)
```

Two instruments over the identical key, contradicting each other — and
anything that copies a value out of a raw descriptor rather than through
`get` inherited whichever one this trap picked.

Per the maintainer ruling on #12601 (Option A — "the envelope wins
consistently"): the four names are reserved on the hook flat-input face.
`getOwnPropertyDescriptor` now checks them first, exactly where `get` already
does, so a descriptor read can never again disagree with a plain read of the
same key. A payload field sharing one of the four names stays a legal record
field — it round-trips through storage unchanged — it is simply not reachable
through the flat face; `ctx.input.data.<name>` is the only route to it.

## Why `patch`, argued rather than assumed

This is the same trap set, the same shape of fix, and the same scope as the
two immediately preceding fixes here — #12397 (descriptor trap mirrors `data`
instead of synthesising) and #12578 (`ownKeys` reports the payload's own key
set) — both shipped `patch`, and both changed what a specific instrument
reports for specific inputs, exactly as this one does:

- **No persisted data moves.** Unlike #12277 (`delete` actually deletes,
  shipped `minor` because it changes what lands in storage), this fix changes
  only what a READ instrument reports; the row the engine writes is byte-for-
  byte identical before and after.
- **The paths that already worked stay byte-identical.** `ctx.input.id`
  itself (`get`), `Object.keys`/spread/`Object.entries`
  (`ownKeys` + the descriptor's `enumerable` flag + `get`'s value) all
  already answered the envelope's value for a reserved name before this fix —
  measured, not assumed (see the test file). The only caller this changes is
  one that reads `Object.getOwnPropertyDescriptor(ctx.input, '<reserved
  name>').value` directly, on a payload that ALSO happens to declare a field
  by that exact reserved name — a combination narrow enough that it is the
  disagreement itself, previously unnoticed, that this card exists to close.
- **It restores an invariant the code already claimed to hold** (`get` and
  the descriptor trap were always supposed to agree — that is the whole
  premise of a "flat view"), rather than adding or removing a capability. A
  hook body that worked correctly before this fix — i.e. one that never
  happened to hit the exact disagreeing combination — is unaffected.

Not declared breaking, so no ADR-0087 disposition marker applies (this
changeset removes/renames no authorable spec key, export, or config field —
`check-adr-0087-registration.mjs` only judges changesets that declare a
breaking/major change).
