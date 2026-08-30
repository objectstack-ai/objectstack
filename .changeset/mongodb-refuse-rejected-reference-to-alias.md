---
"@objectstack/driver-mongodb": minor
---

fix(driver-mongodb): refuse the rejected alias `reference_to` at the schema door instead of honouring it (#13222)

`syncCollectionSchema` gated its field-level join index on `field.reference_to`.
`reference` is the only relationship spelling `@objectstack/spec` declares —
`reference_to` is a **rejected alias**, answered by `FieldSchema` with
`unrecognized_keys` and *"Did you mean `reference_to` → `reference`?"* — so one
key had two doors with opposite answers, and the silent one was the one that
touched the database.

A field still carrying `reference_to` when it reaches schema sync now throws
`VALIDATION_ERROR`/400 naming it as a rejected alias of `reference`, in the same
words `FieldSchema` uses. The refusal is stated ahead of `createCollection` and
ahead of every per-field branch, because the spec's verdict is gated on neither
the field's type nor the key's value: `{ type: 'text', reference_to: 'x' }` is
refused exactly as the `lookup` fixture is, and `'company'`, `null` and `''`
alike. One key, one answer, on both doors — this is the same door
`@objectstack/driver-sql` grew in #11567.

**⚠️ Upgrade note — this IS a behaviour change for a real, non-zero population,
which is why it is graded `minor` and not `patch`.** #11567 could grade the SQL
half `patch` on "no authored deployment could reach the branch". That reasoning
does **not** transfer here: this package's own published `README.md` taught
`reference_to`, in a sample calling `driver.syncSchema(...)` **directly** —

```typescript
company_id: { type: 'lookup', reference_to: 'company' }   // what the README taught
```

— and `syncSchema(object, schema: unknown)` casts and forwards that metadata
**verbatim**, with no Zod, no normalisation and no key filtering. `README.md` is
in the package's `files` array, so it shipped to npm at
`@objectstack/driver-mongodb` **17.2.0 and every earlier version**. A deployment
that copied that sample boots today and, after this release, is refused at the
schema-sync door. The affected population is therefore non-zero **by
construction**, not by speculation — and it is not measurable from inside this
repo. There is deliberately **no deprecation window**: a warn-and-continue
release would be a third answer to a key the schema has always refused.

Fix, if you have such metadata — the same rename the schema has always asked for:

| Wrote | Write instead |
|---|---|
| `{ type: 'lookup', reference_to: 'company' }` | `{ type: 'lookup', reference: 'company' }` |

The README no longer teaches the key; its remaining mention is prose recording
that the spelling is refused.

**What this does NOT change.** No index is added, removed or renamed. A `user`
field still gets `idx_FIELD_lookup`; a canonically-spelled `reference` lookup
still gets none. Renaming the key therefore does not, by itself, produce a join
index — whether it should is a separate open question, because starting to build
that index changes boot behaviour for deployments already holding large
collections. It is tracked apart from this release on purpose.
