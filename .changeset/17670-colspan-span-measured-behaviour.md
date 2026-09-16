---
"@objectstack/spec": minor
---

docs(spec): `FormField.colSpan` and `FormField.span` describe their measured behaviour — the two claims browser measurement falsified are gone (#17670)

Both `.describe()` strings ship inside the published package (`src/**/*.zod.ts`, `dist`, `json-schema`) and they generate the public `content/docs/references/ui/view.mdx` tables, so what they assert is what every reader of the API reference — human or AI — is told the renderer does. Two of those assertions were measured false in Chromium at all three surface widths (#17328, `absolute-colspan-discouraged` withdrawn on the same evidence):

- `colSpan` was described as "fragile … a fixed span only lines up at the width the author imagined". It is not. The renderer clamps the span to the section's column count and emits one container-query-scoped class, so the cell starts at a real column boundary at every width; rendered overflow was 0px in every configuration measured, including `colSpan: 4` in a 3-column section — the case that would overflow if the clamp did not work. The old text contradicted its own next sentence, which already stated the clamp.
- `span: 'full'` was described as "whole row at any column count". It is not. It compiles to a span of the section's declared column count gated at the top breakpoint only (`@2xl:col-span-3` for a 3-column section — the identical class `colSpan: 4` emits), so at the 2-column modal width it renders pixel-identical to authoring nothing at all.

Each key now states what it actually does. **The preference between the two keys is removed, not reversed** — `[legacy — prefer `span`]`, `Prefer `span`.` and `Prefer this over the absolute `colSpan`.` are gone, and nothing replaces them. Both spellings rest on the falsified claim, and the measurement puts the recommended one on the wrong side of it; which key an author should reach for depends on a renderer question (`span: 'full'` not spanning the row at intermediate container widths) that this repository does not answer today and that is deliberately not answered here.

Nothing an author writes moves. Both keys are unchanged, both still parse, every stored form view keeps its shape and its rendering, and no validation, default or emitted class changes. This is a correction to what the package says about itself.
