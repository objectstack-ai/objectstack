---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

A `reference` carrier that no reader can read is now **REFUSED** where it is read, instead of coming back as `undefined`. The source-level gate that guarded the same shape (`check:reference-carrier-shape`) is retired in the same change (#18095, executing a maintainer ruling).

`FieldSchema.reference` is `z.string().optional()`, so `ObjectSchema.safeParse` already refuses an object- or array-valued carrier at the contract door with a located `invalid_type` issue. Measured on the pre-change tree:

```
ObjectSchema.safeParse({ fields: { invoice: { type: 'lookup',
                                              reference: { object: 'shop_invoice' } } } })
  -> success = false, issue invalid_type at path ["fields","invoice","reference"]
control: the same object with reference: 'shop_invoice'
  -> success = true      (so the refusal is about the carrier's SHAPE)
```

What was missing was the other door — the one a value reaches only when it never went through parse at all. #13053's fixture spelled `reference: { object: … }` inside `fields:`, and the rule reading it answered `undefined`: refused where it was written, read as absent where it was consumed, reported nowhere. The fixture passed, and would have kept passing.

**New export — `referenceCarrierOf(def, reader?)` in `@objectstack/spec/data`.** It answers the carrier as the string the contract declares, and throws a `TypeError` naming the shape and the fix when the key is present in any other shape. `null`, `undefined` and `''` are ABSENCE, not a wrong shape, and still answer `undefined` — a field is allowed to name no target.

**`referenceTargetOf` reads through it**, so the single arbiter of "what does this field expand into" refuses rather than answering "no target". Every consumer that already asks the arbiter — `$expand`, the record-title deriver, the dangling-reference audit, the analytics dimension labeller — inherits the refusal with no edit.

**`@objectstack/lint`** routes its own target readers through the same accessor: `refOf` in `validate-security-posture.ts` (the reader in the #13053 incident) and in `data-model-rules.ts`, plus the object-graph slice every other rule downstream reads.

Upgrading: nothing conformant changes. A non-string `reference` could not be authored, stored or parsed before this release either; what changes is that a hand-built fixture or a raw registry entry carrying one now fails loudly at the read instead of being silently treated as targetless. If a test asserted the old silence, assert the refusal instead — `packages/cli/test/data-model-rules.test.ts` is the worked example.
