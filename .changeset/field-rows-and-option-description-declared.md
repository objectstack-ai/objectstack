---
"@objectstack/spec": minor
---

**`rows` and `options[].description` become declared, authorable field-metadata keys** (objectui#6140 / objectui#6153 — maintainer ruling 2026-08-25, Option A, verbatim: 「就全部接受，然后继续下一批」; the accepted-set-expansion follows the #11566/#11949 `maxLength`/`minLength` convergence template).

Both keys were consumed-but-undeclared — real behaviour in the running app, reached through an `as any` on the metadata carrier, while the strict publish door refused exactly the author who wrote them legally:

- `rows?: number` (positive integer) on the multiline editor types `textarea` / `markdown` / `html` / `richtext`. objectui's `RichTextField` — the one widget behind the `markdown`/`html`/`richtext` registry keys — reads `richField?.rows || 8`, and `TextAreaField` reads `textareaField?.rows || 4`, sizing the inline (non-fullscreen) editor surface. The ruled pair is `markdown`/`html` (aligning the `TextareaFieldMetadata` precedent); `textarea`/`richtext` complete the measured consumption set. A superRefine refuses the key on every other type (the #11566 template), and the house count discipline refuses `0` / negative / fractional values. Both authoring forms show the key for exactly this set. The ruling's capability expansion STOPS here: the four inert rich-text editor keys (`toolbar`/`preview`/`minHeight`/`maxHeight`) stay undeclared, and a pin holds that door shut.
- `description?: string` on `SelectOptionSchema`. objectui's `LookupField` searches it on a lookup's authored static options (`opt.description && opt.description.toLowerCase().includes(q)`) and its `recordToOption` produces the same key for fetched options — and the object-definition authoring form has offered a `description` input all along; the declaration makes both honest. It flows into `FormSelectOptionSchema` by the #12868 Omit construction. Per the same inherited ruling, `dependsOn` is deliberately NOT declared — the canonical field-level `depends_on` already exists, and the widget-side spelling fix rides the objectui half.

Additive in both cases: no stored shape changes, and every previously-written body carrying either key was refused at parse, so nothing legal changes meaning.
