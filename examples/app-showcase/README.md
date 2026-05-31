# ObjectStack Showcase (`@objectstack/example-showcase`)

> A kitchen-sink workspace that exercises **every metadata type, every view
> type, every chart type**, and the major **end-to-end capability chains** —
> built for three audiences at once: **demonstration**, **debugging**, and
> **verification**.

Most example apps are intentionally minimal. This one is deliberately
*exhaustive*. It pairs a coherent business domain (project delivery) with a
set of synthetic "gallery" objects whose only job is to cover protocol
variants, and ties the two together with a **coverage manifest** that the test
suite checks against the protocol's own Zod enums.

## Why it exists

Demonstration and verification pull in opposite directions:

- **Demo** wants a believable, connected app — but a realistic app never
  naturally uses all 49 field types, all 8 view types, or all 38 chart types.
- **Verify** wants every variant present and *asserted* — which a single
  realistic domain can't provide.

So the showcase splits into two tracks:

| Track | Purpose | Where |
| :--- | :--- | :--- |
| **Realistic backbone** | A connected delivery domain with seeded data, so every view renders something real. | `Account → Project → Task`, `Team`, `Category` |
| **Gallery / specimens** | Synthetic objects & views that exhaust protocol variants. | `Field Zoo`, the Task view gallery, the Chart Gallery |

## Quick start

```bash
pnpm install
pnpm --filter @objectstack/spec build   # if not already built

# Demonstration — open Studio and click through the gallery
pnpm dev            # → http://localhost:3000/_studio

# Verification — typecheck + coverage test
pnpm verify
```

## What it covers

### Data layer (ObjectQL)
- **All 49 field types** — `src/objects/field-zoo.object.ts` carries one field
  of every `FieldType`, with the remainder appearing naturally on the backbone
  objects.
- **Every relationship kind** — `lookup` (project → account, category → self),
  `master_detail` (task → project), self-referencing **hierarchy/tree**
  (`Category.parent`), and **many-to-many** via the
  `showcase_project_membership` junction.
- **Formulas, validations, and a status state machine** on `Project` and
  `Task`.

### View layer (ObjectUI)
- **All 8 list-view types** on a single object (`src/views/task.view.ts`):
  grid, kanban, gallery, calendar, timeline, gantt, map, chart. The Task object's
  fields are chosen so one object can back every type.
- **All 5 form-view types**: simple, tabbed, wizard, split, drawer.
- **The full chart taxonomy** — `src/dashboards/chart-gallery.dashboard.ts`
  has one widget per chart family (all 38 `ChartType`s).
- **All 4 report types**: tabular, summary, matrix, joined
  (`src/reports/index.ts`).
- **The action matrix** — every `ActionType` (script/url/flow/modal/api/form)
  across every `ActionLocation`.
- **A component-gallery page** placing the standard page components.

### Capability chains (the "complex abilities")
- **Security** (`src/security/index.ts`): a role hierarchy + a permission set
  that layers object CRUD, **field-level security (FLS)**, and
  **row-level security (RLS)**, plus criteria- and owner-based **sharing rules**
  and an org **policy**.
- **Automation**: a record-triggered flow → a screen-flow wizard → a multi-step
  **approval** → an outbound **webhook** → a scheduled **job** → an **email**
  template.
- **AI**: an **agent** wired to a **tool** and a **skill**.
- **i18n / theming / portals**: `en` + `zh-CN` translations, light + dark
  themes, and an external client portal.

## The coverage manifest — how "confirm" works

`src/coverage.ts` declares what the showcase is supposed to cover and provides
the collectors the test uses. `test/coverage.test.ts` then **introspects the
protocol's own enums** (`FieldType`, `ChartTypeSchema`, `ReportType`,
`ActionType`, `ACTION_LOCATIONS`) and asserts every member appears at least
once across the registered metadata.

Because the expected sets come from the **spec** — not a hand-maintained list —
the test fails automatically when the platform gains a new field type, chart
type, or report type that the showcase hasn't demonstrated yet. That keeps this
example a **living conformance fixture**, not a static snapshot. (`defineStack`
itself also runs full schema + cross-reference validation when the config is
imported, so `pnpm test` proves the whole stack loads cleanly.)

## Directory layout

```
app-showcase/
├── objectstack.config.ts        # defineStack — registers everything
├── src/
│   ├── coverage.ts              # coverage manifest + collectors (the soul)
│   ├── objects/                 # field-zoo + backbone + junction + tree
│   ├── views/                   # all 8 list types + all 5 form types
│   ├── dashboards/              # chart gallery (all 38 chart types)
│   ├── reports/                 # tabular / summary / matrix / joined
│   ├── actions/                 # type × location matrix
│   ├── pages/                   # component gallery
│   ├── apps/                    # navigation linking every surface
│   ├── security/                # roles + FLS + RLS + sharing + policy
│   ├── flows/ approvals/ webhooks/ jobs/ emails/   # automation chain
│   ├── agents/                  # agent + tool + skill
│   ├── themes/ translations/ datasources/ portals/
│   └── data/                    # seed data sized to feed every view
└── test/
    ├── coverage.test.ts         # introspects spec enums, asserts coverage
    └── seed.test.ts             # stack-loads + breadth smoke test
```

## Extending it

When you add a new variant to the platform, the coverage test will go red and
point at the gap. Add a field/view/widget that uses it, reference it in
`COVERAGE`, and the test goes green again.
