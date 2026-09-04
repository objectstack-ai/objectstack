---
"@objectstack/spec": patch
"@objectstack/platform-objects": patch
---

fix(spec): the dashboard `gap` field no longer describes itself to app authors in Tailwind vocabulary

`ui/dashboard`'s `gap` key told app authors its value in the vocabulary of a CSS
library they never chose and cannot act on. **Two** independent producer strings
carried that wording, and they feed two independent customer-facing surfaces:

- `dashboardForm`'s `helpText` — `Grid gap (Tailwind units)` — rendered verbatim in
  the Studio property panel, which is spec-driven and feeds this form straight into
  the generic form renderer.
- `DashboardSchema.gap`'s `.describe()` — `Grid gap in Tailwind spacing units` —
  rendered as this field's row in the published reference page
  `content/docs/references/ui/dashboard.mdx`. The reference corpus renders
  `.describe()`, never `helpText`.

Both now read **Space between widgets, in steps of 0.25rem (4 = 1rem)**: what the
author decides, plus the magnitude, stated in a CSS unit instead of a framework's
scale. The magnitude had to survive the rewrite rather than be dropped with the
framework name — the number is a spacing step, so `4` means `1rem` and not `4px`,
and an author who lost that would come away knowing less than before.

The step size is stated as measured rather than inferred: the dashboard renderer
sets the grid gap as an inline style computed from this key, so every accepted
value is linear and one step is exactly `0.25rem`. "Tailwind units" was doubly
wrong — it named an implementation dependency, and it named one the consumer of
this key does not have.

**No schema change.** `gap` stays `z.number().int().min(0).optional()` and accepts
exactly what it accepted before; nothing is added to or removed from any public
surface. `columns` is deliberately untouched on both of its producer lines —
`12` is an author-visible fact about the grid being laid out, not a framework
detail — and this is one field's two strings, not a sweep for framework words.

The `en` metadata-forms translation bundle is a mechanical copy of the form source,
so it is regenerated to match. Translated locales are not touched: regeneration
fills gaps only and never overwrites an existing leaf.
