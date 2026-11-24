# ADR-0084: Application-builder information architecture — six domain groups in a left menu (was: four content pillars)

**Status**: Accepted (2026-07-01) · **Amended in place** (2026-11-24, card [#36891](https://github.com/objectstack-ai/objectstack/issues/36891) of epic [#36890](https://github.com/objectstack-ai/objectstack/issues/36890), maintainer, verbatim: 「元数据列表如果全部改成点击之后弹出全屏的详情页呢？是不是对象流程这些可以用同一种风格，顶部的导航也不需要了。」, 「studio 不是一个应用，是某个应用的开发界面，点击左上角还是返回应用，」, 「我们说的弹出窗口全屏，应该是右侧全屏对吧，左侧菜单和前端一样可以折叠。」, and on the epic's fifteen numbered decisions, twice, 「全部按建议」): the four content pillars are no longer a navigation — Studio is the development surface of one app, its one navigation is a collapsible left menu of six groups that follow the spec's registered domains, and every registered metadata type has a group ([Amendment](#amendment-2026-11-24)). It lands by the hand-merge or authorized approval of the PR cut from #36891.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0077](./0077-authoring-surface-boundary-hook-flow-validation.md) (route authoring by intent + audience + verifiability — the hook/flow/validation boundary), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (draft-gated authoring), [ADR-0063](./0063-two-kernel-agents-skills-are-the-extension-primitive.md)/[ADR-0064](./0064-tool-scoping-to-agent.md) (two kernel agents — AI is a platform capability, not app metadata), [ADR-0080](./0080-ai-authored-ui-jsx-source.md)/[ADR-0081](./0081-trusted-react-page-tier.md) (the Interface pillar's page-authoring depth).
**Consumers**: `studio.app.ts` (the builder navigation), the Studio UI, `packages/cli/src/utils/format.ts` (`os` stats grouping), and the build agent (which surface authors which type).

**Premise**: ObjectStack has far more metadata types than Airtable's clean three, but the **application builder** — the surface a person (or the build agent) uses to *build an app* — must not expose all of them at one altitude, or it stops being learnable. Studio's current grouping is inconsistent (mixes Data with Interface, splits "Logic" from "Automation", scatters the rest). This ADR fixes the builder's information architecture, once, after a long design pass that repeatedly corrected itself. The core question it answers: **which metadata types are the app builder's job, at what altitude, and which belong to entirely different surfaces?**

> **Trigger**: an extended design conversation ("Airtable categorizes as Data / Automation / Interface — I have more types, how do I present them in the builder?"), which converged by successively ruling things in and out.

> **Amendment (2026-11-24) — the four pillars become groups of one left menu.** Studio is the development surface
> of one app, and its one navigation is a collapsible left menu whose six groups follow the domains the spec registers
> metadata types under. What each pillar held is found in a group, unchanged. The pillars as a navigation, the Settings
> area, and the line that kept the Platform and AI types out of the builder no longer describe the surface. Each
> sentence the amendment replaces is struck or marked where it stands and points to
> [Amendment (2026-11-24)](#amendment-2026-11-24); everything not marked stands.

---

## TL;DR

1. **The app builder is for *building an application* — nothing else.** Running it (Operate) and the platform's own machinery (Platform) are different surfaces, different personas; they are **out of the builder entirely**, not deferred. *(Amended 2026-11-24: this stands for Operate. The Platform and AI **types** are in Studio, each in a menu group — see [Amendment](#amendment-2026-11-24).)*
2. **~~Four visual content pillars (Airtable's three plus the one it lacks): Data · Automation · Interface · Access. This is what a builder navigates.~~** *(Replaced by the 2026-11-24 amendment.)* A builder navigates **one left menu of six groups** — 数据 Data · 界面 UI · 自动化 Automation · 平台 Platform · 访问 Access · AI. What the four pillars held is found in the groups of their names (Interface's in 界面 UI).
3. **Each pillar's editor matches the pillar's natural shape**: Data = grid, Automation = canvas, Interface = builder/source, Access = matrix.
4. **Dashboards live in Interface** (Airtable-style: a dashboard is an interface surface of inline chart blocks). A separate **Analytics** pillar is a *future* split, gated on the reusable dataset/cube layer maturing — not a v1 concern.
5. **~~A Settings area (distinct from the content pillars) holds General (the app's own basic info) and Advanced — the technical tier for developers.~~** *(Replaced by the 2026-11-24 amendment: the menu has no Settings group; see [item 2](#amendment-silent) there.)*
6. **~~Advanced is unified by audience, not by "is it code."~~** ~~It holds both **Code** (hooks now; functions, custom components, custom field types later) and **Connections** (datasources, connectors, webhooks, mappings — external data/systems). What unites them: technical, beyond visual authoring, developer audience. There is **no separate Integration tier** — connections are Advanced.~~ *(Replaced by the 2026-11-24 amendment: each of these types is found in the group of its registered domain.)*
7. **v1 ships**: the four pillars + Settings(General + Advanced/**Hooks**). Everything else (the rest of Advanced, Analytics, Operate, Platform) is later or out-of-builder.

---

## The information architecture

*(The diagram below is the 2026-07-01 shape, kept as the record of it. The navigation in force is the menu in [Amendment (2026-11-24)](#amendment-2026-11-24).)*

```
Data · Automation · Interface · Access          ⚙ Settings
(four visual content pillars — for builders)      ├ General    the app's basic info
                                                  └ Advanced   the technical tier — for developers
                                                     ├ Code         hooks (v1) · functions · custom components · custom field types
                                                     └ Connections  datasource · connector · webhook · mapping   (later)

Out of the builder entirely (separate surfaces / personas):
  Operate   ship & run — packages · migrations · flow runs · audit · api keys
  Platform  the platform's own capabilities — AI (agent/tool/skill) · i18n · email & notification templates · settings · studio plugins
```

### The four content pillars (shape → editor)

*(Amended 2026-11-24: read this table for the four designers' shapes, which stand. Its "Types (v1 core)" column holds the working names of 2026-07-01, not registry names; where a type is found is the amendment's [type → group table](#type-to-group).)*

| Pillar | Types (v1 core) | Natural shape | Editor |
|---|---|---|---|
| **Data** | object · field · validation | tabular | a live data **grid** (columns = fields, rows = real records) |
| **Automation** | flow · trigger · action · schedule | sequential | a flow **canvas** (trigger → steps) |
| **Interface** | app · page · view · form · dashboard · report | spatial | a **builder** (canvas + palette) or **source + preview** (html/react pages) |
| **Access** | role · permission · sharing | relational | a permission **matrix** (roles × objects × CRUD + record scope) |

Charts/metrics are **blocks** inside a dashboard/page bound inline to objects — they reuse the SDUI page renderer, so a dashboard is a page with chart blocks, not a separate subsystem.

### Settings

*(Replaced as navigation by the 2026-11-24 amendment: the menu has no Settings group. The app's own definition is the `app` type, found under 界面 UI.)*

- **General** — the app's own identity and defaults: name, id, icon, description, branding, default landing, and the navigation structure. (This is the `app` definition; it is not one of the content pillars — it's *about* the app, not content *in* it.)
- **Advanced** — the technical escape hatch, sub-grouped **Code** and **Connections** (above). Kept visually separate from General so a builder who opens Settings for app info isn't dropped into code (ADR-0077: same area is fine, but different audiences get different groups).

---

## Principles the IA encodes

- **Two altitudes, one job.** Authoring the app (the four pillars + Advanced) is the builder's job. Operating it and the platform beneath it are *different jobs, different people, different surfaces* — so they are not in the builder. The builder stays about building.
- **Shape → editor.** A pillar's data has a natural shape; its editor is that shape (grid/canvas/builder/matrix). This is what lets four different surfaces feel like one product.
- **Same renderer.** The builder manipulates the same live artifact the end user sees — edit a field on the real grid, style a page in a live preview, set a permission on the real matrix. This is also what makes AI authoring safe: the agent edits the same flat, explicit metadata a human does.
- **Audience routing (ADR-0077).** Visual/declarative → the four pillars (builder audience). Code and connections → Advanced (developer audience). AI → not here at all (platform capability). *(Replaced by the 2026-11-24 amendment: the menu draws no audience tier, and AI is one of its groups.)*
- **Primary home + secondary surface for cross-cutting types.** A type is authored in one place and its *result* may appear elsewhere — e.g. a **datasource** is authored in Advanced › Connections, and the external objects it exposes appear in **Data** (with an "external" badge). No type is authored in two menus. *(Amended 2026-11-24: the rule stands and its example moves — a `datasource` is found under 平台 Platform.)*
- **Inline-by-default analytics.** A chart carries its query inline (self-contained); a **dataset** is an explicit opt-in only when the query can't be expressed inline (see #2502), and a dashboard filter is a dashboard variable broadcast to inline charts (see #2501). No implicit/auto-generated datasets — hidden linked entities are hostile to both humans and AI authoring.

---

## Consequences

- The builder is learnable in one glance: four content tabs shaped like their data, plus Settings. Airtable users transfer instantly (Data/Automation/Interface), and the one addition (Access) is obvious. *(Amended 2026-11-24: the glance is one left menu of six groups; the four familiar names are four of them.)*
- The build agent gets a canonical "this type is authored on this surface" map, and a rule that keeps it out of code (Advanced) and off the platform's turf.
- Deferred and out-of-builder concerns have homes that don't distort the builder: Advanced (technical), Operate/Platform (separate surfaces).
- **Cost**: reconciling Studio's current nav (`studio.app.ts`) and the `os` stats grouping to this IA; and drawing the exact edges of "inline vs dataset" (#2502) and the dashboard-filter mechanism (#2501), tracked separately.

## Alternatives considered

*(Amended 2026-11-24: three of the rejections below — six flat pillars, AI as a pillar, Platform inside the builder — were made for a navigation of pillars. The menu's groups now include Platform and AI; the amendment's [What stands](#amendment-stands) says what is left of each.)*

- **Six flat pillars** (Data/Automation/Interface/Access/AI/Integration). Rejected — conflates authoring with a platform capability (AI) and a technical concern (Integration), and buries the differentiators as peers.
- **Analytics as a top-level pillar in v1.** Rejected — premature; dashboards are Interface surfaces (Airtable-style) until the reusable dataset/cube layer justifies a split.
- **Integration as its own tier/area.** Rejected — connections are technical, developer-audience, beyond visual authoring → they *are* Advanced.
- **AI as a builder pillar/tab.** Rejected — agent/tool/skill are the platform's capability (build/ask), not metadata *in* the app being built.
- **Operate / Platform inside the builder.** Rejected — different personas and moments; they're separate surfaces, not deferred builder tabs.
- **A bare "Advanced" top-level tab.** Rejected — the app also needs a home for its basic info; folding Advanced under **Settings** gives code a non-intimidating, expected home and reserves Settings for the deferred technical concerns.
- **Implicit auto-generated datasets behind inline charts.** Rejected — hidden linked state; two entities per intent; sync burden; violates the flat/explicit/local property that keeps AI authoring safe.

Related issues: #2501 (dashboard-level filters), #2502 (inline-vs-dataset expressibility rule).

---

## Amendment (2026-11-24) — one left menu of six domain groups; Studio is the development surface of one app {#amendment-2026-11-24}

**Decided by** the maintainer on 2026-11-24, on epic [#36890](https://github.com/objectstack-ai/objectstack/issues/36890) (the Studio redesign), verbatim and untranslated as that epic records them: 「元数据列表如果全部改成点击之后弹出全屏的详情页呢？是不是对象流程这些可以用同一种风格，顶部的导航也不需要了。」 · 「studio 不是一个应用，是某个应用的开发界面，点击左上角还是返回应用，」 · 「我们说的弹出窗口全屏，应该是右侧全屏对吧，左侧菜单和前端一样可以折叠。」 — and, on the two decision cards that carried the epic's fifteen numbered decisions (1–9 at 06:36Z, 10–15 at 08:03Z), 「全部按建议」. The discussion has **no GitHub record** beyond the epic's quotations: the epic's decision table is what a repository reader can reach, and this section cites its decisions by their number there.

**The amendment declares; it implements nothing.** The menu is card [#36899](https://github.com/objectstack-ai/objectstack/issues/36899) of that epic, and until the epic's children land the code still draws the pillars. The item's side of the same change — its address, the full-screen page, ‹ ›, the leave guard, where a dashboard or a report opens and is created — is [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) D1 as amended the same day.

### What Studio is

- **Studio is the development surface of one app, not an app of its own** (maintainer, above). It is opened on one package, and the scope unit is still the package, its paired `.custom` included (decision 5; ADR-0146 D3).
- **The top-left control returns to the app** (maintainer, above), and the name it shows is the **current package's app**, not the app the person happened to come from (decision 5).
- **Studio has no page of its own above a package.** The landing page — the package cards at `/studio` — is removed by its own card once Setup's package list has landed, each entry it carries moved first (decision 9; [#36908](https://github.com/objectstack-ai/objectstack/issues/36908), [#36834](https://github.com/objectstack-ai/objectstack/issues/36834)).

### The menu

Studio has one navigation: a left menu, on every page, collapsible the way the app's sidebar is (maintainer, 06:31Z). To its right is the content pane, which shows the list of the selected type; an item opened from that list fills the pane (ADR-0146 D1). The four pillars across the top, and the "All metadata" tab ADR-0146 D1 put beside them, are no longer places.

```
‹ 返回应用 · <the current package's app> · Studio

left menu (collapsible)        content pane
  数据 Data                      the selected type's list
  界面 UI                          └ an item opened from it fills the pane   (ADR-0146 D1)
  自动化 Automation
  平台 Platform
  访问 Access
  AI
```

The menu has six groups, one for each domain the spec registers a metadata type under (decision 11):

| # | Group | Registered `domain` |
|---|---|---|
| 1 | **数据 Data** | `data` |
| 2 | **界面 UI** | `ui` |
| 3 | **自动化 Automation** | `automation` |
| 4 | **平台 Platform** | `system` |
| 5 | **访问 Access** | `security` |
| 6 | **AI** | `ai` |

**The rule: a type's group is its registered `domain`.** Every metadata type's registry entry carries one — the `domain` key of `packages/spec/src/kernel/metadata-plugin.zod.ts#MetadataTypeRegistryEntrySchema`, required, one of the six values above — so no type is without a group, and a type registered later lands in its domain's group with no edit to this record. A seventh group is a seventh `domain` value: a change to the spec's contract, with its own ruling. No type is listed in two groups (this record's "no type is authored in two menus", unchanged).

The group's name is decision 11's, not the domain's dictionary word: `system` is drawn **平台 Platform** and `security` is drawn **访问 Access**. (Today's directory draws them 系统 System and 安全 Security.)

### Type → group {#type-to-group}

Every type the spec registers, enumerated at `origin/main` `151e8123` from `packages/spec/src/kernel/metadata-plugin.zod.ts#DEFAULT_METADATA_TYPE_REGISTRY` — 32 entries, the same 32 names as the enum `packages/spec/src/kernel/metadata-plugin.zod.ts#MetadataTypeSchema`:

| Group | `domain` | Registered types | Count |
|---|---|---|---|
| **数据 Data** | `data` | `object` · `object_extension` · `field` · `hook` · `seed` · `picklist` · `mapping` | 7 |
| **界面 UI** | `ui` | `view` · `page` · `dashboard` · `app` · `action` · `report` · `dataset` | 7 |
| **自动化 Automation** | `automation` | `flow` · `job` | 2 |
| **平台 Platform** | `system` | `datasource` · `external_catalog` · `api` · `translation` · `email_template` · `doc` · `book` | 7 |
| **访问 Access** | `security` | `permission` · `position` · `capability` · `sharing_rule` · `queue` · `assignment_rule` | 6 |
| **AI** | `ai` | `agent` · `tool` · `skill` | 3 |

The table is the registry read at one commit. **The rule above is what binds**: a type added to the registry, or given another domain there, moves in the menu without this table being edited, and where the two disagree the registry is right.

Three readings the table needs:

- **A group is where a type is found, not where its item is edited.** Where an item opens is ADR-0146 D1's. A `datasource` is found under 平台 Platform and its row opens Setup's Datasources page, as its tile does today: runtime configuration is Setup's (ADR-0146 D1).
- **Not every type draws a row.** `field` is a 数据 Data type and is edited inside its object; it has no list of its own today, and the amendment gives it none. Which rows the menu draws stays the area's existing rule; the table says where a row goes when there is one.
- **The 2026-07-01 pillar table holds working names, not registry names.** "trigger", "schedule", "validation", "form", "role" and "sharing" are not registered types. `action`, the registered type, is a button on an object or a standalone action, and a `ui` type; the pillar table's "action" was a step of a flow. Where the two tables differ, this one decides.

### Entries that are not a type {#entries-not-a-type}

The menu also holds four entries that open no type's list. Each sits in the group of what it holds:

| Entry | Group | Source |
|---|---|---|
| **The organization's own flows** — the flows that belong to no package (the `~org` scope) | 自动化 Automation | decision 11 |
| **The organization-wide default sharing overview** — a page with a route of its own, not a metadata item | 访问 Access | decision 11 |
| **Diagnostics** | 平台 Platform | decision 11 |
| **The cross-package environment directory** (the `~all` leg) | 访问 Access | **drafted here, not ruled** — [item 1](#amendment-silent) below |

### What stands, and what the amendment replaces {#amendment-stands}

| The 2026-07-01 text | Since the amendment |
|---|---|
| TL;DR 1, "Two altitudes" — the builder is for building an app; Operate and Platform are out of it | Stands for Operate: running an app and administering a deployment are Setup's (ADR-0146 D1). The Platform and AI **types** are in Studio — ADR-0146 D1 gave Studio every type on 2026-10-31 — and now have groups. |
| TL;DR 2 — four pillars are what a builder navigates | Replaced: one left menu, six groups. What each pillar held is in the group of its name (Interface's in 界面 UI). |
| TL;DR 3, the pillar table, "Shape → editor", "Same renderer" | Stand: grid, canvas, builder or source, matrix. A designer now opens as its item's page (ADR-0146 D1). "Same renderer" goes further: a dashboard or a report opens in the app's own edit state (ADR-0146 D1). |
| TL;DR 4 — dashboards live in Interface; Analytics is a future split | Stands: `dashboard`, `report` and `dataset` are `ui` types, found under 界面 UI. A split is a new `domain` value. |
| TL;DR 5 and 6, "Settings" — a Settings area holding General and Advanced | Replaced as navigation: the menu has no Settings group ([item 2](#amendment-silent) below). |
| TL;DR 7 — what v1 ships | History. |
| "Audience routing" — builders in the pillars, developers in Advanced, AI not in the builder | Replaced: the menu draws no audience tier. The line between audiences has run between the two surfaces since ADR-0146 D1 — maintainer, verbatim: 「studio 是给开发人员用的， setup 时给管理员用的」. ADR-0077 is read, not amended. |
| "Primary home + secondary surface" — no type is authored in two menus | Stands, and is the rule the table keeps: one type, one group. Its example moves: a `datasource` is found under 平台 Platform. |
| Alternatives — "Six flat pillars", "AI as a builder pillar/tab", "Operate / Platform inside the builder" | Rejected for a navigation of pillars. The menu follows the registry, and the registry holds the `system` and `ai` types, so 平台 Platform and AI are groups. Operate stays out. ADR-0063 and ADR-0064 (the two kernel agents are the platform's) are read, not amended: a type having a row in the menu changes neither. |
| Consumers — the `os` stats grouping | Not ruled on. The amendment changes Studio's navigation; `packages/cli/src/utils/format.ts` keeps its grouping. |

### Written here where the rulings were silent (for the approver's merge) {#amendment-silent}

Merging accepts them; an objection names the number.

1. **The cross-package environment directory (`~all`) is entered from the 访问 Access group.** Decision 11 places the three other entries of [the table above](#entries-not-a-type) and is silent on this one. The leg's directory lists four types — positions, capabilities, permission sets and sharing rules (the console's `ENVIRONMENT_AREA_TYPES`) — each registered `security`, and the leg's one visible entry today, on the landing page decision 9 removes, is named for exactly that. Decision 11 puts every other such entry in the group of what it holds; this follows it. On that leg the same menu is drawn (the menu card decides whether that is one shell or two frames). Weighed and not taken: an entry of its own outside the six groups, which gives a catalog of four Access types a second place beside the group that already lists them.
2. **The Settings area is not a group.** Decision 11 names six groups and Settings is not one of them, and no ruling speaks of TL;DR 5 and 6. The types those two items placed are found by the rule like every other type: `app` (General) under 界面 UI, `hook` and `mapping` under 数据 Data, `datasource` under 平台 Platform (connectors and webhooks are not registered types). A Settings group would list those types a second time, which the "one type, one group" rule forbids.
3. **The order of the groups and their English names.** Decision 11 lists the six in the order of the table above and names them in Chinese. This record takes that order as the menu's, and writes the English names Data, UI, Automation, Platform, Access and AI.
4. **The title of this record.** It named the four pillars as the decision; it now names the menu and keeps the old words after "was:". The number and the file name do not move (Prime Directive #13).

Refs: epic [#36890](https://github.com/objectstack-ai/objectstack/issues/36890) (the rulings and decisions 1–15); card [#36891](https://github.com/objectstack-ai/objectstack/issues/36891) (this amendment); [#36899](https://github.com/objectstack-ai/objectstack/issues/36899) (the menu), [#36905](https://github.com/objectstack-ai/objectstack/issues/36905) (the default sharing overview's route), [#36908](https://github.com/objectstack-ai/objectstack/issues/36908) (the landing page); [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) D1 (Studio owns all metadata, amended the same day).
