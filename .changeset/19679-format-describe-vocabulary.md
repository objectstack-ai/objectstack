---
'@objectstack/spec': patch
---

**Fix:** `FieldSchema.format`'s description named a vocabulary nothing honours. `Format string (e.g. email, phone)` shipped in the JSON Schema, in `dist`, in the published `src/**/*.zod.ts` and verbatim to a customer in `content/docs/references/data/field.mdx` — and neither `email` nor `phone` is read by anything, on any field type.

`Clause-②: no` — the key is still `z.string().optional()`. Nothing is split, narrowed, retired or gated by type; no accept set moves in either direction and no consumer is touched. Only the sentence changes.

**What actually reads the key, measured on this tree rather than recalled.**

- On an `autonumber` field it is the record-number **pattern** — the shorthand that predates `autonumberFormat`. `resolveAutonumberFormat` takes the canonical key first, then this one, then the declared default `{0000}`, and the ObjectQL engine's `applyAutonumbers` and `driver-sql` both mint through it. Measured against this build: `format: 'INV-{0000}'` → `INV-0001`; `format: 'email'` → `email1` (a value carrying no `{...}` token is literal text with the bare counter appended); `{ autonumberFormat: 'A-{000}', format: 'email' }` → `A-{000}`.
- On a `date` or `datetime` field the Studio UI grid cell reads it as a display **style**, with its own words and its own per-type default, and drops an unrecognised word silently onto a default face.
- Nothing else. It never reaches storage, coercion or write-time validation.

So the author who followed the old sentence onto an autonumber field got `email1` as a business identifier: it parsed, it stored, and nothing reported it.

**Where `email` / `phone` really live**, now stated in the description because that redirect is the whole value of the repair: `email`, `url` and `phone` are field **types** (`type: 'email'`), and the closed `email | url | phone | json` vocabulary belongs to a **`format` validation rule** (`{ type: 'format', field, format: 'email' }`), one schema over. The description also now says outright that the spec declares no vocabulary for this key and validates nothing, so a reader stops expecting a check that does not exist.

The wider question — one `z.string()` key carrying two unrelated vocabularies with two different defaults — is a contract-shape decision and is deliberately untouched here.
