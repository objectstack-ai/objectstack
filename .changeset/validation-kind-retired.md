---
"@objectstack/spec": major
"@objectstack/metadata-core": major
"@objectstack/metadata-protocol": minor
"@objectstack/platform-objects": minor
---

feat(spec)!: retire the standalone `validation` metadata kind (#4509, ADR-0088)

A validation rule authored as its own artifact bound to nothing and gated no
write. `ValidationRuleSchema` carries **no object-binding key** — no `object`,
no `objectName` — and all six variants are `strictObject`, so an author could
not supply one either. No merge step existed. The only code that expected such a
key was a reference-tracker row scanning a field the schema would have stripped.
Meanwhile the engine evaluates exactly one shape: the object's own
`validations[]` array, on insert and on every matched update row.

So a rule created through the standalone door — a `*.validation.ts` file, or
Studio's Validations list — parsed, saved, reported success, and intercepted
nothing. Including a `state_machine` rule, which ADR-0020 routes through this
same vocabulary: an author could believe they had locked down record state
transitions and have changed nothing at all.

Under ADR-0088 the kind fails the admission test on its first clause: a rule has
no independent lifecycle, because it only means something against an object. And
unlike the sibling disconnects closed in this batch, it could not be bridged into
one — the shape has nowhere to name its object.

**The rule vocabulary is untouched.** `ValidationRuleSchema` and all six
variants are unchanged and fully live; the engine's evaluation path is not
modified by this change. It is the *kind* that was inert, not the schema. The
liveness ledger keeps governing it through the gate's `SPEC_ONLY_SCHEMAS`
override (alongside `webhook` and `query`), because an ungoverned live schema is
exactly how the next drift would hide.

**Migration.** Move the rule into the owning object's `validations:` array — the
rule body is identical, same schema, same six variants:

```ts
// before — a standalone *.validation.ts, which never ran
export default defineValidation({ name: 'amount_positive', type: 'script', … })

// after — on the object, where rules are evaluated
ObjectSchema.create({
  name: 'invoice',
  validations: [{ name: 'amount_positive', type: 'script', … }],
})
```

Removed: the registry entry (and its `*.validation.ts` / `*.validation.yml`
patterns), the `MetadataTypeSchema` member, the metadata-core lockstep enum
member, the schema-map entry, the create seed, Studio's Validations nav item and
its hand-crafted form, and the dangling reference-tracker row. Standalone rows
already in `sys_metadata` are left alone — they were never evaluated, so nothing
changes behaviorally.
