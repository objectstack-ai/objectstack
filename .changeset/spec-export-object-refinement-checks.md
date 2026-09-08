---
"@objectstack/spec": minor
---

feat(spec): export the object-level refinement checks the mirrored UI schemas run — `checkListViewPageMount`, `checkListViewCalendarVisualization`, `checkPageSourceCompleteness`, `checkGlobalFilterDateDefaultValue` (#16489, the spec half of objectui#7715)

objectui derives its zod schemas from the spec's `.shape` (`specFieldsExcept(SpecListViewSchema.shape, …)`, six sites at the pinned build). That carries the spec's FIELDS by reference and drops every check attached to the spec OBJECT (`superRefine` / `refine`), so at 17.3.0 objectui's authoring door accepted `appearance.allowedVisualizations: ['calendar']` with no `calendar:` block while the spec's publish door refused it. Contract-first: the rule is written once, in the spec, and a mirror attaches that same rule instead of re-implementing it.

Every spec object that carries an object-level refinement and is mirrored downstream now exports its check as a named, typed function (`(value, ctx: z.RefinementCtx) => void`) from `@objectstack/spec/ui`, alongside the schema — one function per refinement, no bundled "all checks" blob, so a mirror attaches exactly the ones whose fields it carries:

| Schema | Export | Refuses |
|:--|:--|:--|
| `ListViewSchema` | `checkListViewPageMount` | `type: 'page'` with no `pageName`; `pageName` on a view that is not `type: 'page'`; a page mount declaring `columns` |
| `ListViewSchema` | `checkListViewCalendarVisualization` | `'calendar'` in `appearance.allowedVisualizations` with no `calendar:` block |
| `PageSchema` | `checkPageSourceCompleteness` | an `html` / `react` / `jsx` page with no non-empty `source` |
| `GlobalFilterSchema` | `checkGlobalFilterDateDefaultValue` | a `type: 'date'` filter whose `defaultValue` is neither a preset name, an ISO date, nor a date-macro token |

The population is measured from the schemas themselves (`_zod.def.checks`) against the six objectui derivation sites: `ListViewSchema` (2 checks), `PageSchema` (1) and `GlobalFilterSchema` (1 — mirrored by a `.shape` spread rather than `specFieldsExcept`) carry object-level refinements; `NavigationAreaSchema`, `AppSchema`, `DashboardWidgetSchema` and `DashboardSchema` carry none, so nothing is exported for them. The two `ListViewSchema` checks were already named module-private functions and are now exported; the `PageSchema` and `GlobalFilterSchema` checks were inline `superRefine` bodies, extracted verbatim into named functions the schema now attaches by identifier.

Additive, and the schemas are unchanged: every schema attaches the very function it exports, so no accept set moves — every ListView, Page and GlobalFilter document that parsed before parses identically, with identical issues. `minor` because four new symbols land in the published `dist/*.d.ts`. Each export is pinned to be the check its schema runs (`object-refinement-check-exports.test.ts`: parity over every failure path between the direct call, the schema's own check object and the schema's parse; the schema carries exactly as many checks as are exported for it; the module attaches each by identifier). Attaching them at the derivation sites is the objectui half, objectui#7715.
