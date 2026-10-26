---
title: Console App
description: Getting started with the ObjectStack Console — the reference SDUI application for ObjectUI.
---

# ObjectStack Console

The **Console** is the reference application for [ObjectUI](/docs/guide). It renders a full-featured admin interface from JSON metadata — objects, views, dashboards, and actions — with zero custom pages required.

## Quick Start

```bash
# From the repository root
pnpm run setup      # builds @objectstack/* at .objectstack-sha, then installs
pnpm dev            # starts the console dev server (Vite)
```

The console opens at **http://localhost:5180** (the port is fixed in `apps/console/vite.config.ts`). There is no bundled mock backend — `apps/console/.env.development` ships `VITE_SERVER_URL` **empty** (same origin), and the Vite dev server proxies `/api/*` to `http://localhost:3000` by default, so an ObjectStack server has to be listening there. See [Running with a Real Backend](#running-with-a-real-backend) to point dev at a different one.

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-App Switcher** | Switch between the apps discovered from the connected server. |
| **Dynamic Navigation** | Sidebar renders from the app's `navigation` tree (objects, groups, URLs, pages). |
| **Object Views** | List / Grid / Kanban / Calendar — backed by `@object-ui/plugin-view`. |
| **CRUD Dialogs** | Create & edit records via schema-driven forms. |
| **Expression Visibility** | Show/hide navigation items with a CEL `visible` predicate over `current_user` and `features`, e.g. `visible: "'admin' in current_user.positions"`. A `visible` that reads `data` needs the entry to declare a `dataSource`. |
| **Branding** | Per-app colors, favicons, and logos via `AppShell` branding. |
| **Command Palette** | `⌘+K` opens a searchable command bar for quick navigation. |
| **Search in Studio** | On the Studio landing (`/studio`) the header's search, or `⌘+K`, opens the command palette over the Studio rather than an app: its packages, their objects and their flows, matched by label or machine name. A package opens its Data pillar, an object opens in its package's Data pillar, a flow in its package's Automations pillar, and a flow that belongs to no package in `/studio/~org/automations`. App entries, record search and the full-search page are not offered there, since no app is open. |
| **Studio Access** | Studio needs the `studio.access` capability. A caller without it who opens any Studio URL stays on that URL and sees one sentence saying Studio access is needed, in their language, with a **Back to home** link to the declared landing (the launcher where none is declared). The Studio builder is not loaded for them. |
| **Studio Package Scope** | Metadata counts, diagnostics and the metadata lists follow the selected package. The Studio app has no home page of its own: its root opens the first navigation entry that leads to a page, by the same rule as every app. |
| **Package-less Flows in Studio** | Flows that belong to no package — such as a clone of a packaged flow, made from Setup › Packaged automation — are listed and edited at `/studio/~org/automations`, reached from the Studio home ("Not in a package") or the package switcher. They open editable, edits save as drafts, and Publish promotes those drafts. |
| **Studio Automations Rail** | The Automations pillar's flow rail has a search box that matches a flow's label or its machine name, case-insensitively. A long flow name wraps instead of being cut off. |
| **Create App in Studio** | In a package that has no app yet, the Studio header's **Create app** saves the new app as a draft and then opens the **Interfaces** pillar, where that app is designed. Leaving a pillar that holds an unsent edit asks first. |
| **Read-only Packages in Studio** | The Studio home lists code and installed packages under "Installed (read-only · browsable)". Clicking a card opens the package for browsing (`/studio/:packageId/data`). The card's **Customize with an overlay** link opens the package's metadata directory (`/apps/setup/metadata?package=:packageId`). Whether an item can take an environment overlay is decided per metadata type (`allowEnvironmentOverlay`), not per package, and the directory marks each type. Unless the runtime reports `features.marketplace: false`, the section also links to the marketplace (`/apps/setup/system/marketplace`), the same route as Home's "Start with a template". |
| **Edit app (Studio)** | Workspace admins get an **Edit app** button in the top bar inside a running app (the pencil alone on narrow screens), and an **Edit APP in Studio** row at the end of the app switcher, both opening the app's owning package on the Studio design surface. On an interface route — a dashboard, page, or report — they deep-link straight to that surface's design page in the Interfaces pillar (`/studio/:packageId/interfaces?surface=<type>:<name>`, e.g. `surface=page:showcase_crm_workbench`); elsewhere (objects, the app root) they open the package's Data tab (`/studio/:packageId/data`). These interfaces are authored in Studio — there is no in-page edit panel. |
| **Studio Copilot Drafts** | When the AI copilot saves a change to a live app as a draft, its card offers **Review changes and publish** and **Undo**. Review opens Studio's **Changes** drawer for the package: in the Studio copilot it opens in place (same pillar, same selection), and from the full-page chat it opens the package's Studio with the drawer open. The drawer's link is `/studio/:packageId/:tab?changes=review`; Studio opens the drawer to review the pending drafts and drops the parameter. Undo discards the package's pending drafts (`POST /api/v1/packages/:id/discard-drafts`) and asks first when other drafts are pending. The top bar's **Changes** count follows the copilot as its tools answer, including a change the environment publishes immediately. The Studio copilot draws no floating pending-changes bar over its composer: there the top bar's **Changes** and **Publish** are the way to review and publish. The full-page chat and the console dock show that bar while the package has pending drafts. |
| **Dashboard Refresh** | A dashboard page shows a **Refresh All** button at the right of its page header, and a dashboard that sets `refreshIntervalSeconds` (Studio's auto-refresh field) re-reads its widgets' data every that many seconds. Widgets re-read in place, so they are not remounted, and a dataset-bound single-value (KPI) tile re-reads too. `0` or no value means no automatic refresh. |
| **Refused Dashboards and List Views** | The server lists only the dashboards and list views a user may open, so one gated by `requiredPermissions` is not in their lists. When such a dashboard or list view is opened by its URL, the console asks the server about it by name. If the server refuses it with `403 PERMISSION_DENIED`, the page says "You don't have access" and shows the server's sentence, which names the item. The page does not say "not found", and the list page does not switch to the default view. For a name that does not exist, the dashboard page still says it was not found and the list page still opens the default view. An object's own list view that the server sends whole to a user who may edit the object is listed and opens. |
| **Setup Positions** | Setup → Positions lists, for each position, how many people hold it in the active organization and which permission sets it grants. Both columns come from the server (`GET /meta/position?include=grants`), which computes them where it enforces them. A permission set that shares the position's name is granted even though the position does not list it, so it is shown and marked "(by name)". A holder count the server did not serve (no active organization, or no read on position assignments) shows "—", not 0. On every Setup metadata list, a click anywhere on a row opens that item. New Position asks for the permission sets with the label and name, so a position is created and bound in one save. On a position's page, Add holder offers the members of the active organization only (its `sys_member` rows), and Remove asks first, naming the person. |
| **App Creation Wizard** | 4-step wizard (Basic Info → Objects → Navigation → Branding) to create or edit apps. |
| **Record Approvals Tab** | A record with approval requests grows an Approvals tab on its detail page (peer of Details/Related, with a request-count badge) — current step, decision progress, resolved "waiting on" approvers, the merged decision timeline, and a submitter remind button — visible to every viewer who can read the record, not just approvers. |
| **Approval Request Pages** | A request opens on its record page, read through the approvals routes rather than the data API: the request with its decision tally and the `viewer` block its decision actions gate on, and its Timeline from the request's actions route. Those routes serve a request to each party to it, so an approver who is not an administrator sees the full page — fields, decision actions and Timeline — although the data API stays closed to them on both approval objects. |
| **Error Boundary** | Graceful error handling with a retry button. |

### Object design (Studio Data tab)

Selecting an object in Studio's **Data** pillar (`/studio/:packageId/data`) opens
two tabs over that object, **Records · Form**, and an **Advanced** menu that holds
**Validations · Hooks · Actions · API · Settings** (objectui#5813). The
**Advanced** trigger keeps its own name whichever of those panels is open: the
open panel is the checked item inside the menu, and the trigger shows as
selected while one of its panels is open. Each of Validations, Hooks and Actions
is a no-code **config panel driven by the corresponding metadata**, and each
supports **adding** new entries — no code round-trip required:

| Advanced item | Edits | Panel |
|-----|-------|-------|
| **Validations** | the object's inline `validations[]` (spec `ValidationRuleSchema`) | Master-detail covering **every** rule type — `script`, `cross_field`, `state_machine`, `format`, `json_schema`, `conditional`. The **New** menu opens on common rules in plain words (*End date on or after start date*, *Number can't be negative*, *Reject the save when…*); each writes a working rule, or waits for the condition the author gives. Every rule type is under **Advanced**. A new rule whose type carries a condition (`script`, `cross_field`, `conditional`) is saved only once it has one; a rule's type can still be switched in place. CEL predicates reuse the shared `ConditionBuilder`, fed the object's draft fields. |
| **Hooks** | the separate `hook` metadata type targeting this object | Master-detail whose editor is the platform `SchemaForm` **driven by the live `hook` JSONSchema from `/meta/types`**, so its fields and enums always match the running server's contract. |
| **Actions** | the object's inline `actions[]` (spec `ActionSchema`) | Master-detail using the type-aware `ActionDefaultInspector`; anything not curated falls through to a **"More fields"** form fed the live `action` JSONSchema, so no spec property is un-editable. |

Validations and Actions persist with the object's own **Save draft**; Hooks (a
distinct metadata type) save per-hook. Nothing goes live until the package is
published from the top-bar **Publish** flow.

#### Why a configured action can be missing from the app

An action that is saved, published and correctly placed can still appear on no
surface at all. There are two reasons, and the Actions panel states both — the
running app deliberately states neither, because an end user should not be told
about capabilities they do not have.

* **No placement.** `locations` is empty, so the action surfaces nowhere.
  A selection-only action is legitimate here: it is placed by a list view's
  `bulkActions` / `bulkActionDefs` instead.
* **The capability gate.** `action.requiredPermissions` (ADR-0066 D4) is
  enforced with a 403 on the platform action route and **mirrored as a UI
  hide**: a viewer who does not hold every listed capability gets no button,
  no greyed-out control and no message, at every declared location at once.
  This is intended — the client hide mirrors an enforcement the server applies
  regardless, and an unentitled user is never shown a control they cannot use.

The **Placement** section of the action inspector names the gating capabilities
and says the action is hidden rather than disabled; when the signed-in session
is itself missing one of them it says so too, so "I configured the buttons and
I see none of them" has an answer on the screen where the buttons were
configured. The read-only **action preview** beside it carries the same
capability line, so its *Where it appears* frames are not read as a promise
that everyone will see the button there.

An unheld capability is not the same problem as a *misspelled* one: a
capability string registered nowhere is caught separately, by the advisory
capability-reference lint that runs over pending drafts during **Publish**.
It resolves a reference against the platform's built-in capabilities, the
capabilities the registry serves (a package's `defineCapability` declarations)
and every permission set's `systemPermissions`, so a declared capability that
no set grants yet is not reported.

## Configuration

**The console has no configuration file.** It declares no apps, objects or views of its own —
it renders whatever the server it is pointed at publishes. There are only two inputs:

**1. `VITE_SERVER_URL` — which backend to talk to.** A build-time Vite variable, and the only
setting the console itself owns. It seeds the data adapter's base URL and the runtime-config
fetch; `apps/console/.env.development` ships it **empty**, which means same origin — the
Vite dev server proxies `/api/*` to the backend. See [Running with a Real Backend](#running-with-a-real-backend).

**2. Server-pushed runtime config — everything else.** Before React mounts, the console
resolves `/api/v1/runtime/config` from that server and applies it: product branding, feature
flags (marketplace, AI Studio, SSO, custom domain, the storage-usage reading), the cloud URL, and a
host's request to draw no app switcher for a viewer served one app (`hideSingleAppSwitcher`). Operators configure
these on the **server**, not in the SPA, which is why changing them needs no console rebuild.

Apps, objects and views themselves are metadata fetched over HTTP — discovered at connect
time and loaded on demand. To change what the console shows, change the metadata on the
server: author it in the ObjectStack server project (`objectstack.config.ts` lives **there**,
not here) or edit and publish it from Studio. See
[ObjectOS Integration](/docs/guide/objectos-integration) for the server-side configuration
shape.

## Running with a Real Backend

`VITE_SERVER_URL` is the setting that decides which backend the console talks to — the data adapter, auth, i18n and action endpoints all hang off it.

1. In dev, leave `VITE_SERVER_URL` empty and point the dev proxy at your server instead.
   Only `/api/*` is proxied, to `DEV_PROXY_TARGET` when set and `http://localhost:3000`
   otherwise:
   ```bash
   DEV_PROXY_TARGET=https://demo.objectstack.ai pnpm dev
   ```
   This keeps the page and the API on one origin. Setting `VITE_SERVER_URL` to an absolute origin still works, but it opts dev out of same-origin and into CORS — an absolute `VITE_SERVER_URL` is the right setting for a *built* console deployed apart from its backend.
2. The console will use the ObjectStack client to discover metadata and perform CRUD operations against the server.

## Where the Code Lives

Most of what you see in the console does not live in `apps/console`. The shell and layout, sidebar, header, command palette, object list and record detail views all ship from **`packages/app-shell`** (`@object-ui/app-shell`), so any host application can mount the same experience; the heavier view surfaces (grid, kanban, calendar, charts, designer) come from the `@object-ui/plugin-*` packages.

`apps/console` is the assembly layer on top: it owns the route tree, registers the plugin set, wires the backend connection, and adds the surfaces specific to this app (auth pages, the docs portal, system and settings pages). So when you want to change something you *see* in the console, look in `packages/app-shell` first.

## See Also

- [Console Architecture](/docs/guide/console-architecture) — data flow, routing, and plugin integration
- [Schema Overview](/docs/guide/schema-overview) — the JSON protocol that drives the console
- [Data Source](/docs/guide/data-source) — how the adapter fetches and caches data
