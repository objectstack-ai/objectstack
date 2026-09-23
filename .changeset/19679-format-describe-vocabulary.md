---
'@objectstack/spec': patch
---

**Fix:** `FieldSchema.format`'s description said only `Format string (e.g. email, phone)`. It offered two example words without saying which field type they apply to or what reads them, and it shipped in the JSON Schema, in `dist`, in the published `src/**/*.zod.ts` and in `content/docs/references/data/field.mdx`. Followed onto an `autonumber` field, it produced `email1` as a business identifier. The value parsed, it was stored, and nothing reported it.

`Clause-②: no`: the key is still `z.string().optional()`. Nothing is split, narrowed, retired or gated by type. No accept set moves in either direction, and no consumer is touched. Only the sentence changes.

**What the description now says, reader by reader.** Each point was measured, not recalled, and each is stated as what a reader does rather than as a claim that nothing else reads the key.

- On an `autonumber` field the key is the record-number **pattern**, the shorthand that predates `autonumberFormat`. `resolveAutonumberFormat` takes the canonical key first, then this one, then the declared default `{0000}`. The ObjectQL engine's `applyAutonumbers` and `driver-sql` both mint through it, and the build-time autonumber lint in `@objectstack/lint` reads the same pattern. Measured against this build: `format: 'INV-{0000}'` gives `INV-0001`; `format: 'email'` gives `email1`, because a value with no `{...}` token is literal text with the bare counter appended; `{ autonumberFormat: 'A-{000}', format: 'email' }` gives `A-001`.
- On any other field type the server does not act on the key. It picks no column type from it, coerces no value by it and runs no check from it. The write-time record validator's built-in email, url and phone checks key on the field `type`.
- The Studio UI reads the key as a display hint, using words and defaults that its renderers own. The description names two examples. The `date` and `datetime` cells read a display style. On a plain-text field, the shared cell-renderer resolver reads a small word set that promotes the cell to a richer renderer; at the pinned objectui, `{ type: 'text', format: 'phone' }` renders a `tel:` link. The words themselves are deliberately not copied into the spec. They belong to those renderers, and a copy here would go stale without anything going red.
- The spec declares no vocabulary for the key and checks nothing except that it is a string, so any string parses on any field type.

To constrain a **value**, the description points to the field `type` or to a `format` validation rule (`{ type: 'format', field, format: 'email' }`), whose own `format` key is the closed set `email | url | phone | json`.

The wider question is deliberately left alone here. One `z.string()` key is read differently by different readers, and nothing checks that they agree. Whether any of those readings should become a declared vocabulary is a contract-shape decision.
