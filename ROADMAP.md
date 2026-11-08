# ObjectStack Roadmap

> **Last updated:** 2026-11-08
> **Source of truth:** the *Features on the road* table in
> [docs/NORTH-STAR.md](docs/NORTH-STAR.md). That table is the roadmap: its order is the
> priority, and editing it is editing priority. This page is a short public summary of it
> and decides nothing on its own. Where the two disagree, the North Star wins.

ObjectStack is measured by one road: a new AI developer, with a human accepting, starts
from `npm create objectstack`, writes metadata, runs it locally, has verification reject
what is wrong, publishes and installs it into an environment, connects an agent over MCP
to complete one real business operation, and iterates once on a customer request. The
road is walked every week; the first step that breaks is the current P0. Security and
data integrity come first and do not wait for the road.

## Now

The first three steps of the road, where an application is written, run and checked:

- **Set out.** One command scaffolds a project that installs, verifies and paints its
  first screen; the build is the author's first gate; objects, views, forms, record pages
  and custom pages are built without writing code, draft first and then published.
- **Run it locally and see it.** Every capability a business user needs, working in the
  running application: records and forms, list views, kanban, calendar and Gantt,
  permissions that hold on both sides, sharing, sign-in and identity, approvals and
  flows, reports and dashboards, files, the customer's language, and an API others can
  call.
- **Verify.** `objectstack verify`, lint and the health check loudly refuse what is wrong,
  with a prescription, and let through what is right.

## Next

- **Publish and install into an environment.** Packages with an enforced manifest,
  install with or without a control plane, migrations that show their plan first, and an
  ontology you own: diffable in your repository and exportable to run without us.
- **Connect an agent.** The MCP surface exposes what the application really can do,
  fails closed, and says plainly what the open edition does not include.

## Later

- **Iterate on a customer request.** The first-run loop end to end with zero code and zero
  restarts, bringing the customer's existing data in, and structural changes that a dev
  boot heals safely while production takes no liberties.

The order above follows the table. Which step is P0 at any moment is decided by the
weekly walk, not by this page.

## Commercial editions

ObjectOS Cloud and ObjectOS Enterprise are the commercial editions built on this
framework. Their roadmap is published at [objectos.ai](https://objectos.ai), not here.

## Where the details live

- **Open work:** [issues](https://github.com/objectstack-ai/objectstack/issues), filtered
  by the `area:*` labels for one feature axis and by `priority:*` for order.
- **Release targets:** [milestones](https://github.com/objectstack-ai/objectstack/milestones)
  and the `target:*` labels.
- **What has shipped:** each package's own `CHANGELOG.md`; for the view layer under `ui/`,
  each `@object-ui/*` package's `CHANGELOG.md`, with [ui/CHANGELOG.md](ui/CHANGELOG.md) as
  the frozen history of ObjectUI's own releases.
- **What each feature must do, and how it is verified:**
  [docs/qa/platform-checklist/](docs/qa/platform-checklist/).
- **Design decisions:** the ADRs in [docs/adr](docs/adr), and in [ui/docs/adr](ui/docs/adr)
  for the view layer.
