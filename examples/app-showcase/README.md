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
  naturally uses every field type, every view type, or every chart type.
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

### Booting it walled (`isolated` / `group`)

The showcase declares `@objectstack/organizations` (the Apache-2.0 multi-organization
runtime, app-declared per ADR-0132 D3). `os serve` loads it only when
`OS_TENANCY_POSTURE` is `isolated` or `group`; under `single`, the default, it is never
loaded and the boot is unchanged. A production walled boot needs this env, with no edit
to the app:

```bash
pnpm --filter '@objectstack/example-showcase^...' build   # once
cd examples/app-showcase
NODE_ENV=production \
OS_TENANCY_POSTURE=isolated \
OS_AUTH_SECRET=$(openssl rand -hex 32) \
OS_SECRET_KEY=$(openssl rand -hex 32) \
OS_DATABASE_URL=file:./.objectstack/data/app.db \
OS_PLATFORM_OWNER_EMAIL=owner@example.com \
OS_AUTH_MEMBERSHIP_POLICY=invite-only \
  pnpm exec objectstack serve -p 3000
```

Each variable answers one boot refusal: the auth secret, the encryption key, the
storage, the platform owner (a walled posture never promotes the first sign-up), and a
declared membership policy (`invite-only` or an explicit `auto`). Keep both secrets
stable across restarts of the same database.

## What it covers

### Data layer (ObjectQL)
- **All field types** — `src/data/objects/field-zoo.object.ts` carries one
  field of every `FieldType`, with the remainder appearing naturally on the
  backbone objects.
- **Every relationship kind** — `lookup` (project → account, category → self),
  `master_detail` (task → project), self-referencing **hierarchy/tree**
  (`Category.parent`), and **many-to-many** via the
  `showcase_project_membership` junction.
- **Formulas, validations, and a status state machine** on `Project` and
  `Task` — only the rule types the runtime actually **enforces** are
  demonstrated (the unenforced ones are tracked in #1475, not faked here).
- **An object extension** (`src/data/extensions/account.extension.ts`) merged
  additively into `showcase_account` at registration — the package-extends-
  an-object mechanism.
- **An analytics cube** (`src/data/analytics/showcase.cube.ts`) served by the
  analytics service at `/api/v1/analytics/*`.

### View layer (ObjectUI)
- **All 8 list-view types** on a single object (`src/ui/views/task.view.ts`):
  grid, kanban, gallery, calendar, timeline, gantt, map, chart. The Task object's
  fields are chosen so one object can back every type.
- **All 5 form-view types**: simple, tabbed, wizard, split, drawer.
- **The full chart taxonomy** — `src/ui/dashboards/chart-gallery.dashboard.ts`
  has one widget per chart family (all 38 `ChartType`s).
- **Every analytics report type**: summary, matrix, joined
  (`src/ui/reports/index.ts`) — a flat *tabular* list is deliberately an
  object-bound ListView lens, not a report (ADR-0021).
- **The action matrix** — every `ActionType` (script/url/flow/modal/api/form)
  across every `ActionLocation`.
- **Four page-authoring models** — structured (full/slotted), constrained-JSX
  `html`, and executed `react`, taught by the **Page Authoring** index page.

### Capability chains (the "complex abilities")
- **Security** (`src/security/index.ts`): a role hierarchy + a permission set
  that layers object CRUD, **field-level security (FLS)**, and
  **row-level security (RLS)**, plus criteria- and owner-based **sharing rules**
  and an org **policy**.
- **Automation**: a record-triggered flow → a screen-flow wizard → a multi-step
  **approval** → an outbound **webhook** → a scheduled **job** → an **email**
  template, plus live REST/Slack **connector actions**.
- **i18n / theming / portals**: `en` + `zh-CN` translations, light + dark
  themes, and an external client portal.

> **Where is AI?** Deliberately absent. Agents are platform-owned (ADR-0063 —
> third parties author skills/tools, never agents), and the open framework
> exposes AI via `@objectstack/mcp` only. Rather than fake a demo, the
> coverage manifest **waives** `agent`/`tool`/`skill` with tracking issue
> [#2610](https://github.com/objectstack-ai/objectstack/issues/2610).

## The coverage manifest — how "confirm" works

`src/coverage.ts` declares what the showcase is supposed to cover at **two
levels**, and `test/coverage.test.ts` proves both:

- **Kind level** — `KIND_COVERAGE` enumerates every metadata kind in
  `DEFAULT_METADATA_TYPE_REGISTRY`. Each kind is either `demonstrated`
  (pointing at the proof files, which must exist) or explicitly `waived`
  (with a reason **and a tracking-issue link**). A new registry kind fails CI
  until it is accounted for; nothing can silently go missing. The same
  contract covers stack collections that aren't registry kinds
  (`STACK_COLLECTION_COVERAGE`: analyticsCubes, objectExtensions, and the
  waived mappings/connectors).
- **Variant level** — the test **introspects the protocol's own enums**
  (`FieldType`, `ChartTypeSchema`, `ReportType`, `ActionType`,
  `ACTION_LOCATIONS`) and asserts every member appears at least once across
  the registered metadata.

Because the expected sets come from the **spec** — not a hand-maintained list —
the tests fail automatically when the platform gains a new kind, field type,
chart type, or report type that the showcase hasn't demonstrated yet. That
keeps this example a **living conformance fixture**, not a static snapshot.
(`defineStack` itself also runs full schema + cross-reference validation when
the config is imported, so `pnpm test` proves the whole stack loads cleanly.)

The waiver policy is Prime Directive #10 in action: a capability the runtime
doesn't deliver is **never demoed** — it is waived, loudly, with an issue.

## Guided tour & capability map

The app's landing page is the **Capability Map** (`src/ui/pages/
capability-map.page.ts`) — one card per protocol domain linking the flagship
demos. Five **tour docs** (`src/docs/showcase_tour_*.md`) walk each domain,
with live ` ```metadata ` embeds (ADR-0051) rendered from the running
metadata; the **Showcase Manual** book curates them into a Guided Tour group,
served publicly via the library portal.

## Directory layout

`src/` mirrors the protocol domains of the metadata registry
(`DEFAULT_METADATA_TYPE_REGISTRY`), with per-type directories inside each:

```
app-showcase/
├── objectstack.config.ts        # defineStack — registers everything
├── src/
│   ├── coverage.ts              # coverage manifest (PINNED here: package export)
│   ├── docs/                    # doc metadata (PINNED here & flat: CLI contract, ADR-0046)
│   ├── data/                    # ── data domain ──
│   │   ├── objects/             #   field-zoo + backbone + junction + tree + federated
│   │   ├── extensions/          #   object-extension overlay on showcase_account
│   │   ├── analytics/           #   showcase_delivery cube
│   │   ├── hooks/  seed/        #   lifecycle hooks · seed data sized to feed every view
│   ├── ui/                      # ── ui domain ──
│   │   ├── apps/  views/  pages/  dashboards/  datasets/  reports/  actions/
│   │   └── themes/  portals/
│   ├── automation/              # ── automation domain ──
│   │   └── flows/  jobs/  webhooks/
│   ├── system/                  # ── system domain ──
│   │   └── datasources/  emails/  translations/  books/  server/
│   └── security/                # ── security domain: roles + FLS + RLS + sharing
└── test/
    ├── coverage.test.ts         # registry kinds + spec enums, asserted
    ├── gap-fill.test.ts         # cube shape + extension merge (real registry)
    └── seed.test.ts             # stack-loads + breadth smoke test
```

(The AI domain has no `src/ai/` on purpose — see the waiver note above.)

## Extending it

When you add a new variant to the platform, the coverage test will go red and
point at the gap. Add a field/view/widget that uses it, reference it in
`COVERAGE`, and the test goes green again. When you add a new **metadata
kind**, the kind-level test goes red instead: demonstrate it under the right
domain directory, or waive it with a reason + issue in `KIND_COVERAGE`.

## External datasource federation (ADR-0015)

The showcase ships a **code-defined external datasource** that demonstrates the
full federation path with **no external server** — `os dev` just works.

- `src/system/datasources/showcase-external.datasource.ts` — a second, read-only SQLite
  database (`schemaMode: 'external'`), separate from the managed standalone DB.
- `src/data/objects/external/{customer,order}.object.ts` — federated objects
  (`showcase_ext_customer`, `showcase_ext_order`) bound to the remote tables
  `customers` / `orders` via `external.remoteName`. The object names deliberately
  differ from the table names to show the remote-table remap.
- `src/system/datasources/external-fixture.ts` — the stack's `onEnable` hook. It
  idempotently provisions the fixture SQLite file (tables + seed rows), registers
  a live read-only driver under the datasource name, and registers the federated
  objects' read metadata.

**See it:**

- `GET /api/v1/datasources` and `GET /api/v1/meta/datasource` include
  `showcase_external`.
- `GET /api/v1/data/showcase_ext_customer` returns the seeded rows — queried live
  from the external table `customers`.
- Sign in as a platform admin → **Setup → Integrations → Datasources** to see it
  listed, and run the runtime **Sync objects** wizard against it.

To showcase a masked **secret** credential field, uncomment the Postgres variant
in `showcase-external.datasource.ts` and point it at a real warehouse.
