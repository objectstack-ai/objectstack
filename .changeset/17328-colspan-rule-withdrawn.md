---
"@objectstack/lint": minor
---

fix(lint)!: `absolute-colspan-discouraged` is withdrawn — its premise was measured false in a browser, and the alternative it recommended measured worse than the thing it warned about (#17328)

<!-- adr-0087: not-required (no-migration-prescription) nothing an author writes moves: `FormField.colSpan` is untouched in `packages/spec`, still parses, and every stored form view keeps its shape and its rendering. The only surface that moves is one exported TypeScript rule-id constant in `@objectstack/lint` plus the advisory finding it named — neither has a metadata representation, so `objectstack migrate meta` has nothing to reach and the ledger serves nobody affected. -->

**BREAKING** — `@objectstack/lint` no longer exports `FORM_COLSPAN_ABSOLUTE`, and
`validateFormLayout` no longer emits the `absolute-colspan-discouraged` finding. A
TypeScript consumer that imported that constant (to suppress the rule, or to route it)
stops compiling on the import, and the compiler names the site — a more precise channel
than any release note. Authored metadata is untouched: `FormField.colSpan` is unchanged
and still valid.

The rule fired on **every** authored `colSpan`, `colSpan: 1` included, and asserted a
rendering consequence: the form's column count is derived per surface (mobile 1 / modal 2
/ page 3-4), so a fixed span "only aligns at one width". Measured in Chromium on a real
authored 3-column section at all three of the widths that sentence names (390 / 720 /
1700), that misalignment does not happen. The renderer emits one container-query-scoped
span class clamped to the section's declared column count, so the cell starts at a real
column boundary at every width and rendered overflow is 0px in every configuration —
including `colSpan: 4` in a 3-column section, the case that would overflow if the clamp
did not work. The clamp is precisely why the claim was false, and the rule's own file
already recorded the clamp a few lines above the claim.

The hint was the sharper defect. It steered authors to `span: 'full'`, which compiles to
the same class as `colSpan: 4` (`@2xl:col-span-3`) and measures byte-identically: the rule
warned about one spelling and recommended the other, and they are the same thing. At the
modal width `span: 'full'` renders pixel-identical to authoring nothing at all, so an
author who complied was left worse off than one who ignored it.

With no authored `colSpan` shape left that misbehaves there was nothing to re-ground, so
the rule is withdrawn rather than narrowed: `colSpan: 1` emits no class at all, a
`colSpan` within the column count renders exactly as authored, and one above it clamps.
Every test that pinned the rule's wording or its firing set was re-judged in place with
the reason recorded, never deleted, and each re-judged pin is paired with a live finding
on the same fixture so that a walk which stopped reaching the site could not pass as a
withdrawal.
