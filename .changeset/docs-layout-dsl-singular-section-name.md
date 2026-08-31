---
"@objectstack/docs": patch
---

fix(docs): give the three singular `section:` form-section examples in `layout-dsl.mdx` a `name` i18n anchor (#13759)

`content/docs/protocol/objectui/layout-dsl.mdx` teaches form sections twice over: as a
`sections:` **sequence**, and as a singular `section:` **mapping** — one section on its
own. The sequence examples were given `name` anchors in the sweep that added the gate's
YAML arm (#13761); the three singular ones were outside that sweep's population and stayed
nameless. `FormSectionSchema.name` is the "Stable identifier for translation lookup", so a
nameless section has no anchor and renders its authored label in every locale — on pages
whose whole job is to teach the convention.

Three sites, and they are **not** three copies of one edit:

| fence | before | added |
|:---|:---|:---|
| `### Basic Grid Layout` | `label: Contact Information` | `name: contact_information` |
| `### Custom Span Widths` | `label: Product Details` | `name: product_details` |
| `### Responsive Breakpoints` | **no `label:`** — only `columns:` + `fields:` | `name: responsive_grid` |

The first two take the snake_case of their own label, which is the convention #13761 used
for the sequence examples on this same page (`contact_information`, `basic_info`,
`billing_information`). The third has no label to snake_case: it is deliberately minimal so
the breakpoint discussion is about `columns` collapsing, and none of the three fences' ASCII
"Rendered Grid" diagrams draw a section header. So it gets a descriptive `name` and **no
invented `label:`** — adding one would have desynchronised the diagram directly below it,
and the i18n symptom the other two carry does not even arise for a section with no heading
to mis-render.

`FormSectionSchema.name` stays `z.string().optional()` — no schema moves here, per #10709
and #10830.

**These three sites are correct now and still unguarded**, deliberately.
`check-docs-section-name` judges `sections:` sequences in both of its arms; a singular
`section:` mapping is outside both, which is how these three drifted in the first place.
Widening the gate means deciding which YAML keys introduce a form section at all — a
population question fenced out of this PR by the #13759 triage ruling and filed separately.
