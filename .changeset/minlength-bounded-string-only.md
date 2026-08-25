---
'@objectstack/spec': minor
---

`FieldSchema.minLength` tightens on both axes (#11949, maintainer ruling 2026-08-25) — `maxLength`'s twin defect pair (#11566), closed with the same template. Shape: the key is now `z.number().int().min(1)`, so `minLength: 0`, negative and non-integer declarations are refused at parse. The lower bound is 1 by ruling: "no minimum" is expressed by omitting the key, not by declaring a vacuous truth — `minLength: 0` can never fail, and a permanently-true declaration is exactly the noise an AI metadata author mass-produces, so it is refused loudly at authoring time. Applicability: the key sat on the base schema and was authorable on every field type; it is now refused on any type that does not store a bounded string, and accepted on exactly the `BOUNDED_STRING_FIELD_TYPES` set — `text`, `textarea`, `email`, `url`, `phone`, `password`, `markdown`, `html`, `richtext`, `code`, `signature`, `qrcode` (twelve members since #11875) — the same set `maxLength` converged on.

What newly gets rejected: `minLength: 0` / negative / non-integer on any type, and `minLength` with any value on every non-bounded-string type (`boolean`, `number`, `date`, `select`, `lookup`, `autonumber`, `formula`, `json`, `secret`, …). Both rejections are prescriptive — the message names the legal shape, the legal type set, and the fix. The two authoring forms converge on the same set (`field.form.ts` previously showed the key for three types; `object.form.ts` for nine). Already-legal declarations (a positive-integer `minLength` on a bounded-string type) round-trip byte-identically, and absence stays absence — no default materializes.

<!-- adr-0087: registered field-min-length-malformed-or-misplaced-refused -->
