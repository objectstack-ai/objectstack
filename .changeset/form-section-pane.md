---
"@objectstack/spec": minor
"@objectstack/example-showcase": patch
---

feat(spec): `FormSection.pane` — explicit split-pane placement (objectui#2153 follow-up)

A `type: 'split'` form view had no way to say which pane a section renders in:
the renderer hardcoded "first section left, everything else right". That
positional rule is invisible in the metadata — nothing in the JSON records the
assignment — so reordering sections silently moved them across the divider, and
an author (human or AI) could not place two sections side by side on the left at
all.

`FormSectionSchema` gains an optional `pane: 'primary' | 'secondary'`:

- **Explicit and per-section**, so placement survives reordering and an agent
  editing the view can see — and must preserve — where each section lives.
- **Omitted → the legacy rule** (first section `primary`, others `secondary`),
  so existing keyless metadata keeps its exact layout.
- **Split-only, enforced loudly**: a `FormViewSchema` refinement rejects `pane`
  on any other form type at parse (covering the legacy `groups` alias and the
  defaulted `type: 'simple'`). "Accepted but ignored" is the failure mode this
  key must never have — a silent no-op reads as working, especially to an AI
  author. zod 4 keeps refinements through `.extend()`, so the flattened
  runtime-overlay variant in `ViewMetadataSchema` enforces it too.
- Strict two-value enum, not free text — a typo (`'left'`) is a parse error.

The `'split'` type's enum comment claimed "Master-Detail split"; master-detail
already has two homes (`subforms` on the form, related lists on record pages),
so the comment now states split's actual, non-redundant meaning: side-by-side
resizable panes with sections placed via `section.pane`.

The showcase task form's `split` view previously declared a single section —
which renders as a plain (unsplit) form — and now demonstrates the feature:
two sections with explicit panes.

Renderer support ships in ObjectUI (`SplitForm` → `FormSchema.fieldPanes`,
whose pane keys are already named `primary`/`secondary` — a 1:1 mapping).
