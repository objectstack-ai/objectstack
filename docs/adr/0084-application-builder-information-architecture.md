# ADR-0084: Application-builder information architecture — six domain groups in a left menu (was: four content pillars)

**Status**: Accepted (2026-07-01) · **Amended in place** (2026-11-24, card [#36891](https://github.com/objectstack-ai/objectstack/issues/36891) of epic [#36890](https://github.com/objectstack-ai/objectstack/issues/36890), maintainer, verbatim: 「元数据列表如果全部改成点击之后弹出全屏的详情页呢？是不是对象流程这些可以用同一种风格，顶部的导航也不需要了。」, 「studio 不是一个应用，是某个应用的开发界面，点击左上角还是返回应用，」, 「我们说的弹出窗口全屏，应该是右侧全屏对吧，左侧菜单和前端一样可以折叠。」, and on the epic's fifteen numbered decisions, twice, 「全部按建议」): the four content pillars are no longer a navigation — Studio is the development surface of one app, its one navigation is a collapsible left menu of six groups that follow the spec's registered domains, and every registered metadata type has a group ([Amendment](#amendment-2026-11-24)). It lands by the hand-merge or authorized approval of the PR cut from #36891. · **Amended in place** (2026-11-25, card [#37199](https://github.com/objectstack-ai/objectstack/issues/37199) of the same epic, on decision card [#37192](https://github.com/objectstack-ai/objectstack/issues/37192)'s ruling record, [comment 7151834490](https://github.com/objectstack-ai/objectstack/issues/37192#issuecomment-7151834490), maintainer, verbatim: 「同意」, with the adjustments 「选项列表 5也放到高级」 and 「AI 应该提到第一层分类，放在最下面」): on a package the menu draws its six groups in two tiers — the ten **常用 Common** types, always listed, and one collapsed **高级 Advanced** fold that holds every other type and entry under its group's label; this replaces the 2026-11-24 line "the menu draws no audience tier", and the type-to-group table gains an order column and a tier column ([Amendment](#amendment-2026-11-25)). It lands by the hand-merge or authorized approval of the PR cut from #37199. · **Amended in place** (2026-11-26, card [#37451](https://github.com/objectstack-ai/objectstack/issues/37451) of epic [#37424](https://github.com/objectstack-ai/objectstack/issues/37424), maintainer, verbatim, as that epic records them: 「App Studio 就是开发软件包的入口吧」, 「现在你软件包的下拉菜单就只剩切换了，还不如做成切换，加上一个新建按钮」, 「Studio 应该是一个专用的企业色，不需要和应用的企业色一致。防止晕了」 and 「或者叫概览？」, and, on the decision card that carried the phase plan, the pick 「按推荐启动」): Studio — App Studio, 应用搭建 — is the entry for developing a package; its frame is two columns with no top bar, the package switcher returns to the top left with 新建软件包, 概览 Overview is the menu's first entry, Studio's accent is its own graphite, and each control the top bar held has a named home; organization-level content is written as ruled the same day, and the three questions the maintainer has not answered are written as open ([Amendment](#amendment-2026-11-26)). It lands by the hand-merge or authorized approval of the PR cut from #37451.
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

> **Amendment (2026-11-25) — the menu draws two tiers, 常用 Common and 高级 Advanced.** The six groups stand. On a
> package the menu lists the 常用 types under their groups, and one collapsed 高级 fold beneath them holds every other
> type and entry, each still under its group's label. The type-to-group table gains an order column and a tier column.
> The one sentence this replaces — the 2026-11-24 amendment's "the menu draws no audience tier" — is struck where it
> stands, each sentence it narrows is marked, and all of them point to
> [Amendment (2026-11-25)](#amendment-2026-11-25); everything not marked stands.

> **Amendment (2026-11-26) — App Studio is the entry for developing a package: two columns, no top bar.** The six
> groups and the two tiers stand. The top bar goes. The top left holds two rows: Studio's own, and under it the way
> back to the app beside a package switcher that ends in 新建软件包. The menu's first entry is 概览 Overview, the open
> package's own page. Studio has its own accent, graphite. Each control the top bar held has a named home. Three
> questions the maintainer has not answered are written as open and decide nothing. Each sentence this replaces or
> narrows is marked where it stands and points to [Amendment (2026-11-26)](#amendment-2026-11-26); everything not
> marked stands.

---

## TL;DR

1. **The app builder is for *building an application* — nothing else.** Running it (Operate) and the platform's own machinery (Platform) are different surfaces, different personas; they are **out of the builder entirely**, not deferred. *(Amended 2026-11-24: this stands for Operate. The Platform and AI **types** are in Studio, each in a menu group — see [Amendment](#amendment-2026-11-24).)*
2. **~~Four visual content pillars (Airtable's three plus the one it lacks): Data · Automation · Interface · Access. This is what a builder navigates.~~** *(Replaced by the 2026-11-24 amendment.)* A builder navigates **one left menu of six groups** — 数据 Data · 界面 UI · 自动化 Automation · 平台 Platform · 访问 Access · AI. What the four pillars held is found in the groups of their names (Interface's in 界面 UI).
3. **Each pillar's editor matches the pillar's natural shape**: Data = grid, Automation = canvas, Interface = builder/source, Access = matrix.
4. **Dashboards live in Interface** (Airtable-style: a dashboard is an interface surface of inline chart blocks). A separate **Analytics** pillar is a *future* split, gated on the reusable dataset/cube layer maturing — not a v1 concern. *(Amended 2026-11-26: a `dataset` is no longer counted with them. It is to be registered a `data` type and found under 数据 Data; dashboards and reports stay under 界面 UI, and no Analytics group is made — [Amendment](#amendment-2026-11-26-moves).)*
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
- **Audience routing (ADR-0077).** Visual/declarative → the four pillars (builder audience). Code and connections → Advanced (developer audience). AI → not here at all (platform capability). *(Replaced by the 2026-11-24 amendment: ~~the menu draws no audience tier~~ the menu draws two tiers, 常用 Common and 高级 Advanced — amended 2026-11-25, [Amendment (2026-11-25)](#amendment-2026-11-25) — and AI is one of its groups.)*
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

- **Studio is the development surface of one app, not an app of its own** (maintainer, above). It is opened on one package, and the scope unit is still the package, its paired `.custom` included (decision 5; ADR-0146 D3). *(Amended 2026-11-26: reworded — Studio is **the entry for developing a package**. The unit was the package already, so a package with no app is developed there like any other. It is still not an app of its own: [Amendment (2026-11-26)](#amendment-2026-11-26-position).)*
- **The top-left control returns to the app** (maintainer, above), and the name it shows is the **current package's app**, not the app the person happened to come from (decision 5). *(Amended 2026-11-26: both stand, and the control moves — it is the first control of the top left's second row, and the name is shown beside it by the package switcher: [Amendment (2026-11-26)](#amendment-2026-11-26-frame).)*
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

*(Amended 2026-11-25: the drawing lists the six groups and their order, which stand. On a package they are drawn in two tiers — the 常用 Common types under their groups, then one 高级 Advanced fold — as [Amendment (2026-11-25)](#amendment-2026-11-25) sets out.)*

*(Amended 2026-11-26: the drawing's first line is the top bar, which goes. The frame in force is the drawing in [Amendment (2026-11-26)](#amendment-2026-11-26-frame): two columns, the way back in the left column's second row, and 概览 Overview above the groups. The six groups and their order stand.)*

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

Every type the spec registers, enumerated at `origin/main` `151e8123` from `packages/spec/src/kernel/metadata-plugin.zod.ts#DEFAULT_METADATA_TYPE_REGISTRY` — 32 entries, the same 32 names as the enum `packages/spec/src/kernel/metadata-plugin.zod.ts#MetadataTypeSchema` *(33 at the 2026-11-25 reading, in the note under the table)*:

| Group | `domain` | Order | Registered type | Tier |
|---|---|---|---|---|
| **数据 Data** | `data` | 1 | `object` 对象 | 常用 |
| **数据 Data** | `data` | 2 | `picklist` 选项列表 | 高级 |
| **数据 Data** | `data` | 3 | `hook` 钩子 | 高级 |
| **数据 Data** | `data` | 4 | `mapping` 字段映射 | 高级 |
| **数据 Data** | `data` | 5 | `object_extension` | 高级 |
| **数据 Data** | `data` | 6 | `seed` | 高级 |
| **数据 Data** | `data` | — | `field` | — |
| **界面 UI** | `ui` | 1 | `app` 应用 | 常用 |
| **界面 UI** | `ui` | 2 | `page` 页面 | 常用 |
| **界面 UI** | `ui` | 3 | `dashboard` 仪表盘 | 常用 |
| **界面 UI** | `ui` | 4 | `report` 报表 | 常用 |
| **界面 UI** | `ui` | 5 | `view` 视图 | 高级 |
| **界面 UI** | `ui` | 6 | `action` 操作 | 高级 |
| **界面 UI** | `ui` | 7 | `dataset` 数据集 | 高级 |
| **自动化 Automation** | `automation` | 1 | `flow` 流程 | 常用 |
| **自动化 Automation** | `automation` | 2 | `job` | 高级 |
| **平台 Platform** | `system` | 1 | `doc` 文档 | 高级 |
| **平台 Platform** | `system` | 2 | `book` 文档手册 | 高级 |
| **平台 Platform** | `system` | 3 | `email_template` 邮件模板 | 高级 |
| **平台 Platform** | `system` | 4 | `translation` | 高级 |
| **平台 Platform** | `system` | 5 | `api` | 高级 |
| **平台 Platform** | `system` | 6 | `datasource` | 高级 |
| **平台 Platform** | `system` | 7 | `external_catalog` | 高级 |
| **访问 Access** | `security` | 1 | `permission` 权限集 | 常用 |
| **访问 Access** | `security` | 2 | `position` 岗位 | 高级 |
| **访问 Access** | `security` | 3 | `assignment_rule` 分配规则 | 高级 |
| **访问 Access** | `security` | 4 | `sharing_rule` 共享规则 | 高级 |
| **访问 Access** | `security` | 5 | `queue` | 高级 |
| **访问 Access** | `security` | 6 | `capability` | 高级 |
| **AI** | `ai` | 1 | `agent` 智能体 | 常用 |
| **AI** | `ai` | 2 | `tool` 工具 | 常用 |
| **AI** | `ai` | 3 | `skill` 技能 | 常用 |
| **AI** | `ai` | 4 | `ai_context` *(registered after the ruling — [item 6](#amendment-2026-11-25-silent))* | 高级 |

*(Amended 2026-11-25: the table is redrawn one row per type and gains two columns, **Order** and **Tier** — [Amendment (2026-11-25)](#amendment-2026-11-25). Read again at `origin/main` `a33691e567`: 33 entries — the 32 of the first reading, each in the domain it had, and `ai_context`, registered `ai` on 2026-11-25 ([ADR-0160](./0160-record-scoped-ai-inquiry.md) D1). No type changed group, and the rows count 数据 Data 7 · 界面 UI 7 · 自动化 Automation 2 · 平台 Platform 7 · 访问 Access 6 · AI 4.)*

The rows are in the menu's order: by group, then by **Order**, which counts inside a group. **Tier** is 常用 Common or 高级 Advanced. The Chinese word beside a registered name is the one the ruling or its proposal uses for that type; a type neither names in Chinese has none. `field` carries no order and no tier because it draws no row (the second reading below).

The table is the registry read at one commit. **The rule above is what binds**: a type added to the registry, or given another domain there, moves in the menu without this table being edited, and where the two disagree the registry is right. *(Amended 2026-11-25: that sentence is about the Group and `domain` columns. The Order and Tier columns are read from no registry — they are decided in this record, and a type the table has no row for is drawn in 高级 Advanced, at the end of its group: [Amendment (2026-11-25)](#amendment-2026-11-25).)*

Three readings the table needs:

- **A group is where a type is found, not where its item is edited.** Where an item opens is ADR-0146 D1's. A `datasource` is found under 平台 Platform and its row opens Setup's Datasources page, as its tile does today: runtime configuration is Setup's (ADR-0146 D1). *(Amended 2026-11-26: the first sentence stands. The example moves again — the menu is to draw no `datasource` row at all, because a connection is managed in Setup alone; the type stays registered `system`: [Amendment (2026-11-26)](#amendment-2026-11-26-moves).)*
- **Not every type draws a row.** `field` is a 数据 Data type and is edited inside its object; it has no list of its own today, and the amendment gives it none. Which rows the menu draws stays the area's existing rule; the table says where a row goes when there is one. *(Amended 2026-11-25: narrowed for the 常用 Common types — on a package each is drawn whether the package holds one or not. The area's rule stays for the 高级 Advanced types, and `field` still draws no row.)*
- **The 2026-07-01 pillar table holds working names, not registry names.** "trigger", "schedule", "validation", "form", "role" and "sharing" are not registered types. `action`, the registered type, is a button on an object or a standalone action, and a `ui` type; the pillar table's "action" was a step of a flow. Where the two tables differ, this one decides.

### Entries that are not a type {#entries-not-a-type}

The menu also holds four entries that open no type's list. Each sits in the group of what it holds:

| Entry | Group | Source |
|---|---|---|
| **The organization's own flows** — the flows that belong to no package (the `~org` scope) | 自动化 Automation | decision 11 |
| **The organization-wide default sharing overview** — a page with a route of its own, not a metadata item | 访问 Access | decision 11 |
| **Diagnostics** | 平台 Platform | decision 11 |
| **The cross-package environment directory** (the `~all` leg) | 访问 Access | **drafted here, not ruled** — [item 1](#amendment-silent) below |

*(Amended 2026-11-25, card [#37360](https://github.com/objectstack-ai/objectstack/issues/37360), ruling record [comment 7177310364](https://github.com/objectstack-ai/objectstack/issues/37360#issuecomment-7177310364), maintainer, verbatim: 「37360 同意」: on a package the menu holds a fifth entry, **全部类型 All types**, the last row of the 高级 Advanced fold, below its groups — the one entry that sits under no group. It opens the type directory, which lists every type of the six groups: the ones the package holds, and the ones it holds none of yet, each marked so with what can be done there. The fold's rule stands — a 高级 type is drawn when the package holds one.)*

*(Amended 2026-11-26, card [#37451](https://github.com/objectstack-ai/objectstack/issues/37451): on a package the menu holds one more entry that opens no type's list — **概览 Overview**, the open package's own page, the menu's first row, above the groups, under no group and in no tier ([Amendment (2026-11-26)](#amendment-2026-11-26-overview)). Two rows of the table above leave the menu for Setup: Diagnostics, and the cross-package environment directory, whose Setup group is open. The organization's own flows keep their entry until the door that moves loose items into a package ships, and retire with it. The default sharing overview and 全部类型 All types stay ([Amendment (2026-11-26)](#amendment-2026-11-26-moves)).)*

### What stands, and what the amendment replaces {#amendment-stands}

| The 2026-07-01 text | Since the amendment |
|---|---|
| TL;DR 1, "Two altitudes" — the builder is for building an app; Operate and Platform are out of it | Stands for Operate: running an app and administering a deployment are Setup's (ADR-0146 D1). The Platform and AI **types** are in Studio — ADR-0146 D1 gave Studio every type on 2026-10-31 — and now have groups. |
| TL;DR 2 — four pillars are what a builder navigates | Replaced: one left menu, six groups. What each pillar held is in the group of its name (Interface's in 界面 UI). |
| TL;DR 3, the pillar table, "Shape → editor", "Same renderer" | Stand: grid, canvas, builder or source, matrix. A designer now opens as its item's page (ADR-0146 D1). "Same renderer" goes further: a dashboard or a report opens in the app's own edit state (ADR-0146 D1). |
| TL;DR 4 — dashboards live in Interface; Analytics is a future split | Stands: `dashboard`, `report` and `dataset` are `ui` types, found under 界面 UI. A split is a new `domain` value. *(Amended 2026-11-26: `dataset` is to be registered `data` and found under 数据 Data, directly after `object`. `dashboard` and `report` stay `ui` types. This is one type changing domain, not the Analytics split: no `domain` value is added — [Amendment (2026-11-26)](#amendment-2026-11-26-moves).)* |
| TL;DR 5 and 6, "Settings" — a Settings area holding General and Advanced | Replaced as navigation: the menu has no Settings group ([item 2](#amendment-silent) below). |
| TL;DR 7 — what v1 ships | History. |
| "Audience routing" — builders in the pillars, developers in Advanced, AI not in the builder | Replaced: ~~the menu draws no audience tier.~~ *(Amended 2026-11-25.)* The menu draws two tiers, **常用 Common** and **高级 Advanced** — a second axis beside the six groups, not a seventh group ([Amendment (2026-11-25)](#amendment-2026-11-25)); maintainer, verbatim: 「同意」, to the seat's question "同意整体加「常用 / 高级」这一层吗？同意的话，ADR-0084 里「菜单不分受众层级」那句，就以你的话为依据改掉。" The line between audiences has run between the two surfaces since ADR-0146 D1 — maintainer, verbatim: 「studio 是给开发人员用的， setup 时给管理员用的」. ADR-0077 is read, not amended. |
| "Primary home + secondary surface" — no type is authored in two menus | Stands, and is the rule the table keeps: one type, one group. Its example moves: a `datasource` is found under 平台 Platform. |
| Alternatives — "Six flat pillars", "AI as a builder pillar/tab", "Operate / Platform inside the builder" | Rejected for a navigation of pillars. The menu follows the registry, and the registry holds the `system` and `ai` types, so 平台 Platform and AI are groups. Operate stays out. ADR-0063 and ADR-0064 (the two kernel agents are the platform's) are read, not amended: a type having a row in the menu changes neither. |
| Consumers — the `os` stats grouping | Not ruled on. The amendment changes Studio's navigation; `packages/cli/src/utils/format.ts` keeps its grouping. |

### Written here where the rulings were silent (for the approver's merge) {#amendment-silent}

Merging accepts them; an objection names the number.

1. **The cross-package environment directory (`~all`) is entered from the 访问 Access group.** Decision 11 places the three other entries of [the table above](#entries-not-a-type) and is silent on this one. The leg's directory lists four types — positions, capabilities, permission sets and sharing rules (the console's `ENVIRONMENT_AREA_TYPES`) — each registered `security`, and the leg's one visible entry today, on the landing page decision 9 removes, is named for exactly that. Decision 11 puts every other such entry in the group of what it holds; this follows it. On that leg the same menu is drawn (the menu card decides whether that is one shell or two frames). Weighed and not taken: an entry of its own outside the six groups, which gives a catalog of four Access types a second place beside the group that already lists them. *(Amended 2026-11-26: ruled since, and differently — the directory leaves Studio's menu for Setup. Which Setup group holds it is open, and until it moves it is entered from 访问 Access as this item says: [Amendment (2026-11-26)](#amendment-2026-11-26-moves).)*
2. **The Settings area is not a group.** Decision 11 names six groups and Settings is not one of them, and no ruling speaks of TL;DR 5 and 6. The types those two items placed are found by the rule like every other type: `app` (General) under 界面 UI, `hook` and `mapping` under 数据 Data, `datasource` under 平台 Platform (connectors and webhooks are not registered types). A Settings group would list those types a second time, which the "one type, one group" rule forbids.
3. **The order of the groups and their English names.** Decision 11 lists the six in the order of the table above and names them in Chinese. This record takes that order as the menu's, and writes the English names Data, UI, Automation, Platform, Access and AI.
4. **The title of this record.** It named the four pillars as the decision; it now names the menu and keeps the old words after "was:". The number and the file name do not move (Prime Directive #13).

Refs: epic [#36890](https://github.com/objectstack-ai/objectstack/issues/36890) (the rulings and decisions 1–15); card [#36891](https://github.com/objectstack-ai/objectstack/issues/36891) (this amendment); [#36899](https://github.com/objectstack-ai/objectstack/issues/36899) (the menu), [#36905](https://github.com/objectstack-ai/objectstack/issues/36905) (the default sharing overview's route), [#36908](https://github.com/objectstack-ai/objectstack/issues/36908) (the landing page); [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) D1 (Studio owns all metadata, amended the same day).

---

## Amendment (2026-11-25) — two tiers in the menu: 常用 Common and 高级 Advanced {#amendment-2026-11-25}

**Decided by** the maintainer on 2026-11-25, on decision card [#37192](https://github.com/objectstack-ai/objectstack/issues/37192) of epic [#36890](https://github.com/objectstack-ai/objectstack/issues/36890). The words were given in the owning seat's session and are on that card as the seat recorded them there, verbatim and untranslated; the card and its comments are the record a repository reader can reach:

- **The trigger**, on a screenshot of the new left menu: 「studio 调整后的左侧菜单，功能有了，重点不清晰了。」 (the card's body).
- **The direction**: 「包括很多应该属于对象下的，是不是默认不需要看到，或者有些不常用的，折叠到高级下」 ([comment 7151652724](https://github.com/objectstack-ai/objectstack/issues/37192#issuecomment-7151652724)).
- **Two adjustments** to the proposal written from it ([comment 7151777190](https://github.com/objectstack-ai/objectstack/issues/37192#issuecomment-7151777190), cited below by its section numbers): 「选项列表 5也放到高级」 and 「AI 应该提到第一层分类，放在最下面」 ([comment 7151811337](https://github.com/objectstack-ai/objectstack/issues/37192#issuecomment-7151811337)).
- **The ruling**: 「同意」, to the seat's question "同意整体加「常用 / 高级」这一层吗？同意的话，ADR-0084 里「菜单不分受众层级」那句，就以你的话为依据改掉。" ([comment 7151834490](https://github.com/objectstack-ai/objectstack/issues/37192#issuecomment-7151834490), the ruling record).

**The amendment declares; it implements nothing.** The placement list and the two tests that pin it are card [#37200](https://github.com/objectstack-ai/objectstack/issues/37200), and the menu that reads the list is card [#37201](https://github.com/objectstack-ai/objectstack/issues/37201). Until they land the code draws the six groups flat, each group's types in the order the server lists them.

### The two tiers

The six groups of decision 11 stand, and so does the rule that a type's group is its registered `domain`. A tier is a second axis beside the group, not a seventh group: every type has one group and one tier, and inside the fold an entry still sits under its group's label.

- **常用 Common** — the types a package's menu always lists: a 常用 type is drawn whether the package holds one or not, so a package without one still shows where the first is made. They are these ten, in this order, each word the ruling's, with the type's registered name beside it:
  - 数据 Data: 对象 `object`
  - 界面 UI: 应用 `app` · 页面 `page` · 仪表盘 `dashboard` · 报表 `report`
  - 自动化 Automation: 流程 `flow`
  - 访问 Access: 权限集 `permission`
  - AI: 智能体 `agent` · 工具 `tool` · 技能 `skill` — the last visible group
- **高级 Advanced** — one collapsed fold under the 常用 groups. It holds every other type and every entry that is not a type, each under its group's label, in the order of the [type → group table](#type-to-group). The ruling names three of them: 选项列表 `picklist`, 邮件模板 `email_template`, and 默认共享, the default sharing overview. A 高级 type is drawn by the area's existing rule, when the package holds one.

A group's label is drawn in a tier only where the group has an entry in that tier (§3.3). 平台 Platform holds no 常用 type, so its label is drawn inside the fold alone. AI is the last of the five groups drawn above the fold, and its label is drawn again inside the fold only where a package holds an `ai_context` ([item 6](#amendment-2026-11-25-silent)).

The four [entries that are not a type](#entries-not-a-type) are 高级 on a package. Each is drawn after the types of its group, the default sharing overview before the cross-package directory — where the menu adds them today (§3.4).

The tiers belong to a package's menu. The package-less scope (`~org`) and the cross-package leg (`~all`) draw no fold: the same labels and the same order, flat (§3.8).

*(Amended 2026-11-26: the two tiers, the ten 常用 types and the rule below stand. 概览 Overview is drawn above the tiers and belongs to neither. Of the four entries that are not a type, Diagnostics and the cross-package directory are to leave the menu. Whether `dataset` and `position` join the 常用 types, placed by name, is open — question 4 on [#37424](https://github.com/objectstack-ai/objectstack/issues/37424). See [Amendment (2026-11-26)](#amendment-2026-11-26-moves).)*

### The rule that sorts a type

The rule is the proposal's (§3.1), ruled as proposed. A type is **常用** only when all three hold; a type that fails one is **高级**:

1. **It has no parent object.** Its schema does not require one object. A type bound to one object is authored from that object.
2. **A builder makes it directly, as a step of building an app.** It is not reference content, and not developer or operator work.
3. **It stays inside the open package.** An entry that leaves the package's scope — the organization's own flows, the cross-package directory — is 高级 on a package.

**A type with no row in the table is drawn in 高级, at the end of its group. It is never invisible.**

The rule sorts the next type; the table records what was ruled. Where the maintainer places a type by name, the name decides, and the ruling carries two such placements: `picklist`, which the proposal had placed in 常用, is 高级 on 「选项列表 5也放到高级」; `agent`, `tool` and `skill`, which it had placed in 高级, are 常用 on 「AI 应该提到第一层分类，放在最下面」.

### What the amendment replaces, and what stands

| The text before | Since the amendment |
|---|---|
| The 2026-11-24 amendment, at "Audience routing" and in [its own table](#amendment-stands): "the menu draws no audience tier" | Replaced: the menu draws two tiers. The sentence beside it stands — the line between audiences runs between Studio and Setup (ADR-0146 D1). |
| The menu's drawing: six groups, flat | Stands as the six groups and their order. On a package they are drawn in two tiers. |
| "A type's group is its registered `domain`"; one type, one group; a seventh group is a seventh `domain` value | Stand. A tier is not a group, and no type is listed twice. |
| The type → group table | Redrawn one row per type, with the Order and Tier columns. No type changed group. One row is new: `ai_context`, registered that day ([item 6](#amendment-2026-11-25-silent)). |
| "Which rows the menu draws stays the area's existing rule" | Narrowed: on a package a 常用 type is always drawn. The area's rule stays for the 高级 types, and `field` still draws no row. |
| The 2026-07-01 "Advanced" — the Settings area's technical tier (TL;DR 5 and 6) | Not brought back. It was an area outside the pillars, and the 2026-11-24 amendment replaced it. 高级 is a fold of the one menu, and every type in it keeps its group. |
| [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) D1 | Not edited: it defers the menu to this record. |

### Written here where the ruling was silent (for the approver's merge) {#amendment-2026-11-25-silent}

Merging accepts them; an objection names the number.

1. **The order of the types the proposal's list does not write out.** Its ordered list (§3.4) is written out for the 数据 Data and 界面 UI types and stops there. The Order column takes the rest from the proposal's drawing of the open fold (§3.2) and, for a type that drawing does not show, from the row order of its per-type table (§2), reading a row that names several types left to right. That places `job` after `flow`; `translation` · `api` · `datasource` · `external_catalog`, in that order, after `email_template`; and `sharing_rule` · `queue` · `capability`, in that order, after `assignment_rule`.
2. **Where `picklist` sits inside 高级.** The maintainer moved it between the tiers and named no place. It keeps the place the proposal's list gave it, second in 数据 Data, which makes it the first 高级 entry of that group.
3. **Where the four entries that are not a type sit.** After the types of their group, as §3.4 leaves them. The proposal's per-type table (§2) lists the organization's own flows between `flow` and `job`; this record follows §3.4, so on a package that holds a `job`, that type's entry is drawn above the organization's flows.
4. **The tiers' English names.** The ruling names the tiers in Chinese. This record writes Common and Advanced, after the two values of the proposal's list (§3.4).
5. **The table's shape.** One row per type, so that each type carries its own order and tier. Order counts inside a group, because the order of the groups is the six-group table's.
6. **A type registered after the ruling was written: `ai_context`.** The proposal and the ruling were made on a registry of 32 types. `ai_context`, the context pack of [ADR-0160](./0160-record-scoped-ai-inquiry.md) D1, was registered under `ai` the same day, after both. The maintainer's words on AI are 「AI 应该提到第一层分类，放在最下面」, and the ruling record lists the group's 常用 types as 智能体 · 工具 · 技能: three types, and not this one. Three ruled sentences place it, and they agree: its schema requires one root object, so the first test of the rule sorts it 高级; 高级 holds every type the ruling does not list as 常用; and a type with no row is drawn at the end of its group. The table writes that down as a row — last in AI, 高级 — so that the placement list has a row to mirror. If every AI type is meant to be 常用, the tier of this one row is the word to change.

The ruling also carries, as proposed and not restated here: the menu's visual hierarchy (§3.3), the placement list and its two pins (§3.4), how the fold is opened, remembered and searched (§3.5), and that no address changes (§3.9). Those are the work of #37200 and #37201.

Refs: decision card [#37192](https://github.com/objectstack-ai/objectstack/issues/37192) (the ruling record, comment 7151834490; the proposal, comment 7151777190; the adjustments, comment 7151811337); epic [#36890](https://github.com/objectstack-ai/objectstack/issues/36890) (decision 11: the six groups stand); card [#37199](https://github.com/objectstack-ai/objectstack/issues/37199) (this amendment); [#37200](https://github.com/objectstack-ai/objectstack/issues/37200) (the placement list and its pins), [#37201](https://github.com/objectstack-ai/objectstack/issues/37201) (the menu).

---

## Amendment (2026-11-26) — App Studio is the entry for developing a package; two columns, no top bar {#amendment-2026-11-26}

**Decided by** the maintainer on 2026-11-26, on epic [#37424](https://github.com/objectstack-ai/objectstack/issues/37424) (the App Studio redesign). The words were given in the session of the seat that filed the epic and are on the epic's body as that seat recorded them, verbatim and untranslated:

- **The position**: 「App Studio 就是开发软件包的入口吧」
- **The switcher**: 「现在你软件包的下拉菜单就只剩切换了，还不如做成切换，加上一个新建按钮」
- **The colour**: 「Studio 应该是一个专用的企业色，不需要和应用的企业色一致。防止晕了」
- **The menu's look**: 「左侧菜单的分类效果也参考前端」 · 「左侧菜单选中效果也和前端保持一致」 · 「可以不要背景」
- **The overview**: 「或者叫概览？」 · 「是不是技术元素太重」 · 「最近发布，我们的修改，都不要放在首页。」 · 「包含的内容，左侧菜单已经有了。」 · 「软件包概览页，是不是就是软件包元数据的详情页？现在没有嘛？」
- **The dataset**: 「数据集 是AI 也要用的吧？不能算界面吧」
- **The plan**: 「同意，立专题，不派发」, and on what Setup takes over (the epic's decision 12), 「同意」.
- **The first phase, and the top bar's controls**, the same day, on the decision card of the area that took the epic up: the pick 「按推荐启动」, whose recommended option read, as card [#37451](https://github.com/objectstack-ai/objectstack/issues/37451) records it: 「返回放左上第二行，⋯和发布进概览页，保存/取消放详情页头，AI放标题行右端。」
- **Organization-level content**, the same day, in that area's thread: 「同意」, to the area's proposal that questions 2 and 3 of the epic's five be ruled as recommended. The ruling record on the epic sets out what was recommended ([comment 7184753035](https://github.com/objectstack-ai/objectstack/issues/37424#issuecomment-7184753035)).
- **The `form` type**, a question and not a ruling, as card #37451 records it ([comment 7184972402](https://github.com/objectstack-ai/objectstack/issues/37451#issuecomment-7184972402)): 「Studio 菜单还没有 form 类型是吗？怎么规划？」

The discussion has **no GitHub record** beyond four places, and they are what a repository reader can reach: the epic's body (the quotations above and its decisions 1–12); the epic's phase table and its five questions ([comment 7184108099](https://github.com/objectstack-ai/objectstack/issues/37424#issuecomment-7184108099)); the ruling record for questions 2 and 3 (comment 7184753035); and card #37451 with its comments (the pick, the five homes it gives, the question on `form`, and that the name 应用搭建 / App Studio was kept when a rename was put to the maintainer). This section cites a decision by its number in the epic's body, and a question by its number in comment 7184108099.

**The amendment declares; it implements nothing.** It is written once for all five phases of the epic, so that a later phase changes code and not this record. The first phase is four cards: [#37452](https://github.com/objectstack-ai/objectstack/issues/37452) (the menu's look and the graphite tokens), [#37454](https://github.com/objectstack-ai/objectstack/issues/37454) (概览, built thin), [#37455](https://github.com/objectstack-ai/objectstack/issues/37455) (Save, Cancel, the AI button and the panel toggle in their new homes) and [#37456](https://github.com/objectstack-ai/objectstack/issues/37456) (the top bar removed; the two rows, the switcher, the lock, the rail). The later phases are rows of the epic's phase table, not yet filed. Until those cards land the code still draws the top bar. What a later phase cannot do without a ruling is under [Open](#amendment-2026-11-26-open).

### What Studio is {#amendment-2026-11-26-position}

- **Studio is the entry for developing a package** (maintainer, above; decision 1). Work on one package is done in Studio, opened on that package. Setup → Packages is the list of all packages — where one is installed or imported — and each row there opens that package's 概览 Overview in Studio (decisions 10 and 12).
- **This rewords the 2026-11-24 sentence "the development surface of one app". It does not change the unit**, which was the package already, its paired `.custom` included (ADR-0146 D3). What follows from the new words: a package with no app is developed in Studio like any other, and no part of the frame waits for an app.
- **Studio is still not an app of its own**, and the way back to the app stands ([the frame](#amendment-2026-11-26-frame)).
- **Its name is App Studio, and 应用搭建 in a Chinese interface** (decision 2). The label today is "Studio" (`packages/platform-objects/src/apps/studio.app.ts#STUDIO_APP`), so the English name changes as well. Only display text changes: the `/studio` address, the registered app name `studio` and every identifier stay. A Chinese interface shows 应用搭建 and not the English name. The epic's mockups draw "App Studio" on a Chinese screen, and the [North Star](../NORTH-STAR.md)'s `area:ux` row — a Chinese interface shows no stray English — decides against them. The name says 应用 and the unit is a 软件包: the name is for the person who comes to build an app, and the package is what that app ships in. Elsewhere in this record "Studio" still means this surface.

### The frame {#amendment-2026-11-26-frame}

Studio's frame is two columns — the left column and the content pane — and **no top bar** (decision 3). It is the shape the app's own shell has from 768 px up (ADR-0146 D5's note). The 2026-11-24 ruling took the pillars off the top; this takes the bar.

```
left column (collapsible)                      content pane
  应用搭建 App Studio             [collapse]      the open page: 概览, a type's list, or an item
  ‹  <app logo> <package> <lock>   [switch]       └ the right end of its title row holds the
                                                     page's own buttons (the table below)
  概览 Overview            <pending count>
  数据 Data
  界面 UI
  自动化 Automation
  访问 Access
  AI
  高级 Advanced
```

The top left has two rows.

1. **Studio's row**: Studio's mark and name, and the control that collapses the left column.
2. **The package row**: the way back, then the open package — its app's logo, its name, a lock when it is read-only — which is the package switcher.

**The way back stands** (2026-11-24, maintainer: 「点击左上角还是返回应用」). It is the first control of the package row. Where it leads is unchanged — `ui/packages/app-shell/src/views/studio-design/StudioBackToApp.tsx#studioBackTarget`: the app page the person came from when that app is the package's, else the package's own app, else the apps home.

**The package switcher is restored** (maintainer, above; decision 3). This reverses its removal by [#36501](https://github.com/objectstack-ai/objectstack/issues/36501). It lists the packages the person may open, and picking one opens it. Its last row is **新建软件包 New package**, which opens the dialog Setup's package list already uses (`ui/packages/app-shell/src/views/metadata-admin/PackageFormDialog.tsx#PackageFormDialog`). A pair is not a row: `<base>.custom` is folded under its base. That is ADR-0146 D3's sentence on the switcher, in force again.

**Read-only** (decision 8). A package the person cannot write to shows a lock beside its name in the package row, and each "New" button in that package says in its tooltip why it is off. No list carries a banner for it.

**Collapsed**, the left column is a rail that keeps the app's logo and the way back (decision 3).

**The menu looks like the app's sidebar** (maintainer, above; decision 5). A group's header is the front end's, and it collapses. An icon is a line icon with no tile behind it. The selected row is the front end's pill with its bar, inset from the edge. Decision 5 changes how the menu is drawn and nothing about what it holds: the six groups, their order, the two tiers, the fold and 全部类型 All types stand.

**Studio has its own accent, graphite, and never takes the app's theme colour** (maintainer, above; decision 4). A person who steps from an app into Studio sees by the colour that they have left the app. The one thing in the frame that keeps the app's colour is the app's logo.

### Where the top bar's controls go {#amendment-2026-11-26-homes}

The top bar is drawn by `ui/packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx`. Read at `origin/main` `a46efa8c`, it holds seven things. Five have a home by the maintainer's pick, one by decision 3, and one is given none.

| What the top bar holds | Its home | By |
|---|---|---|
| The way back to the app, with the app's name | The first control of the package row; the name is shown by the switcher beside it | the pick |
| The ⋯ package menu (`ui/packages/app-shell/src/views/studio-design/StudioPackageMenu.tsx#STUDIO_PACKAGE_MENU_ITEMS`) | The header of 概览 Overview, moved as it is | the pick |
| The pending-changes button with its count, and Publish | The Pending tab of 概览 Overview. The count is a badge on the menu's 概览 row, and one click on it opens that tab | the pick |
| Save and Cancel, drawn while a page has unsaved edits | The action slot of the item's header (`ui/packages/app-shell/src/views/studio-design/StudioItemHeader.tsx#StudioItemHeader`) | the pick |
| The AI assistant button, and the toggle of the right-hand panel | The right end of each page's title row — a list's title row, an item's header — where an app's page carries its own (`ui/packages/app-shell/src/layout/ShellPageActions.tsx#ShellPageActions`) | the pick |
| The control that shows and hides the menu | Studio's row | decision 3 |
| For a package with no app: the "create app" button, or the label that says its app waits for a publish | None — [item 5](#amendment-2026-11-26-silent) | not ruled |

Decision 3 says the ⋯ menu "is removed". It is read with decision 9 and the pick: the menu leaves the top left, and its rows live on in 概览's header.

### 概览 Overview {#amendment-2026-11-26-overview}

**概览 Overview is the menu's first entry and the open package's own page** (maintainer, above; decisions 6 and 9). It opens no type's list, and **there is no `package` metadata type**: the page reads and writes through the package REST surface. It is drawn in the frame an item's page has — the item header and its row of tabs — so that a package opens like anything else Studio opens (maintainer: 「软件包概览页，是不是就是软件包元数据的详情页？」).

- **The header**: the package's name; a chip that reads 系统自带 or 可写, and one that reads 使用中 or 已停用; the description; then 导出 Export and ⋯.
- **信息 Info**: the business fields, with the technical ones (id, namespace, type) folded away (maintainer: 「是不是技术元素太重」).
- **待发布 Pending**: the changes that wait for a publish, and Publish. It is the changes panel that exists, in its new home.
- **发布历史 Publish history**: the list of publishes, and "revert to last publish".

It is not a page of news: no recent publishes, no "our changes", no list of what the package contains (maintainer: 「最近发布，我们的修改，都不要放在首页。」 · 「包含的内容，左侧菜单已经有了。」).

**What Pending counts.** The save rule of epic [#36510](https://github.com/objectstack-ai/objectstack/issues/36510) stands (ADR-0146 D1, *One save model*): a person's Save takes effect at once, and a draft with a whole-package publish is how an AI's changes arrive. So Pending counts the open package's drafts — an AI's changes, and any human draft left from before that rule, which ADR-0146 D1 has a person publish or discard. For a pair it acts on the pair (ADR-0146 D3). The count is the badge on the menu's 概览 row, drawn only while something is pending. Publish is the last step of building an app, and the badge is what keeps it one click away once the top bar is gone.

**The first phase builds it thin** (#37454): Info, read-only; Pending; and the ⋯ menu moved from the top bar with the six rows it has today — edit info, export, duplicate, revert to last publish, adopt loose items, manage in Setup. The header's final layout belongs to a later phase: Export as its own button, the ⋯ rows of decision 9, and revert on the Publish history tab. What each kind of package may do — kernel, code, marketplace, authored — follows the rules that exist, and every action reuses its existing dialog and confirmation (decision 9).

### Placements, and what moves to Setup {#amendment-2026-11-26-moves}

Decision 12 draws the line: **Studio develops one package; Setup runs the organization and holds what is global** (maintainer: 「同意」). Five places follow from it and from decision 6. A sixth is written for a type that is about to join the menu.

- **`dataset` is a 数据 Data type, placed directly after `object`** (maintainer: 「数据集 是AI 也要用的吧？不能算界面吧」; decision 6). A dataset is the semantic layer that charts and an AI's data questions both read (`packages/spec/src/ui/dataset.zod.ts#DatasetSchema`), so it is data and not interface. It moves the way this record says a type moves: its registered `domain` changes from `ui` to `data` in `packages/spec/src/kernel/metadata-plugin.zod.ts#DEFAULT_METADATA_TYPE_REGISTRY`. That is a change to the spec's contract, and it owes a contract review in its own card. No special case is written into the menu for it.
- **`position` stays where it is in 访问 Access, directly after `permission`.** Decision 6 also places it in the 常用 tier; that is question 4.
- **Diagnostics leaves the menu for Setup → Diagnostics**, beside Audit Log and Sessions (decision 12). It is the page that lists, across types, every metadata item that fails validation. [Item 7](#amendment-2026-11-26-silent) sets this beside an earlier ruling.
- **The cross-package environment directory (`~all`) leaves the menu for Setup** (decision 12). Decision 12 names Setup → Diagnostics as its group. What the directory lists is access metadata — positions, permission sets, capabilities and sharing rules — and which Setup group holds it is question 5.
- **The menu draws no `datasource` row** (decision 12). A connection is configuration bound to an environment, and it is managed in Setup → Integrations alone. The type stays registered `system`; like `field`, it is a type that draws no row.
- **`form`, once Studio lists it, is a 界面 UI type, placed directly after `view`.** [ADR-0159](./0159-forms-are-their-own-metadata-type-public-forms-are-form-items-view-is-lists-only.md) carves forms out of `view` into a type of their own and registers it `ui` (its D2). The card that registers the type keeps it out of Studio's directory until the card that brings its designer ([#37086](https://github.com/objectstack-ai/objectstack/issues/37086), [#37087](https://github.com/objectstack-ai/objectstack/issues/37087)). Its group is the rule's: its registered domain. Its place is beside the type it was carved from. Its tier is 高级 by the rule's first test, because a form is bound to one object. Whether the maintainer places it among the 常用 types by name is put to him with question 4 ([Open](#amendment-2026-11-26-open); [item 11](#amendment-2026-11-26-silent)).

Two entries do not leave for Setup. The organization's own flows (`~org`) keep their entry in 自动化 Automation until the door that moves loose items into a package ships, and retire with it ([Organization-level content](#amendment-2026-11-26-org)). The organization-wide default sharing overview stays in 访问 Access.

Decision 12 also says how the two surfaces speak of each other: whose sharing rules, queues and assignment rules each side shows; a position defined in Studio and assigned in Setup, linked both ways; one vocabulary for a package's source and state. None of that changes a place in the menu, and it is left to its cards.

When the registry and the placement list have changed, the two groups these moves touch read, in order:

- 数据 Data: `object` · `dataset` · `picklist` · `hook` · `mapping` · `object_extension` · `seed`
- 界面 UI: `app` · `page` · `dashboard` · `report` · `view` · `form` · `action`

**The [type → group table](#type-to-group) is not redrawn today.** A test pins it, row by row, to the registry and to the placement list (`ui/packages/app-shell/src/views/studio-design/studioMenuPlacement.test.ts`), and both still hold `dataset` under `ui`, `datasource` with a row, no `form`, and every tier as ruled on 2026-11-25. A row is rewritten, or written, in the change that moves it — the same pull request, since the pin fails otherwise: `dataset`'s with its registry change, `datasource`'s with the menu's, and `form`'s when the type is taken off the directory's hidden types. Each of those carries out this section and needs no further ruling. Until then the table is what the menu draws.

### Organization-level content {#amendment-2026-11-26-org}

Decision 11 of the epic, as ruled on its questions 2 and 3 (maintainer: 「同意」; ruling record [comment 7184753035](https://github.com/objectstack-ai/objectstack/issues/37424#issuecomment-7184753035), which this part follows). It is phase 4's work.

- **There is no catch-all package.** [ADR-0070](./0070-package-first-authoring.md) D1 and D6 stand.
- **A create with no package asks for one, and the kernel refuses it** (question 2, ruled A). When no package resolves, the interface asks the person to pick a package or create one. The kernel closes the same create, which ADR-0070 D1 already requires and the kernel does not yet do ([#37453](https://github.com/objectstack-ai/objectstack/issues/37453)'s readings). Four writers keep a named exemption, and no other: an overlay of a kernel item, until the platform pair's whitelist exists; the ruled import of an external datasource; a migration that preserves a binding; and platform registration. `os meta register` is closed with the rest. The interface's ask and the kernel's close ship in the same phase, the kernel last. Saving a loose row that already exists, in place, stays open. Sharing rules, queues and assignment rules that an organization authors in Setup bind to the `.custom` package of the object that owns them, with no new exemption.
- **Loose items stay where they are, and one door moves them** (question 3, ruled C). An item that belongs to no package stays legal: it belongs to the implicit environment package (ADR-0150 D1, the fourth bucket), and nothing is renamed or migrated. One new door moves a selection — one item, several, or all — into a package, and runs each through the judges a save runs. It reuses the list page that exists. When that door ships, the bulk adopt and Studio's `~org` entry retire together. This replaces the page that sorts loose items one by one, which decisions 11 and 12 planned. Where the new door is opened from is its card's to say.
- **What this changes in the menu.** The organization's own flows keep their entry in 自动化 Automation until the door ships. The ⋯ menu keeps "adopt loose items" until then, and loses it then.

ADR-0070 is not edited by this amendment. Where the ruling restates its D1 and D5, the phase-4 cards that carry the ruling out owe that record its marks.

### What the amendment replaces, and what stands {#amendment-2026-11-26-stands}

| The text before | Since the amendment |
|---|---|
| 2026-11-24: "Studio is the development surface of one app, not an app of its own" | Reworded: the entry for developing a package. The unit was the package already. Still not an app of its own. |
| 2026-11-24: "The top-left control returns to the app", and names the current package's app | Stands, and moves: the first control of the package row, with the name shown by the switcher beside it. Where it leads is unchanged. |
| 2026-11-24: "Studio has no page of its own above a package" | Stands. 概览 is a page of one package, not a page above packages; the list of all packages is Setup's. |
| The menu's drawing: a bar above the menu | Replaced: no top bar; two rows at the top left. |
| The six groups and their order; "a type's group is its registered `domain`"; one type, one group | Stand. `dataset` changes group by changing its registered domain, which is the rule applied. |
| 2026-11-25: the two tiers, the rule that sorts a type, the ten 常用 types | Stand. 概览 is in neither tier. Whether `dataset` and `position` join the 常用 types by name is open (question 4). |
| "Entries that are not a type": four, and 全部类型 All types | 概览 is added, first. Diagnostics and the cross-package directory leave for Setup. The organization's own flows retire when the door that moves loose items ships. The default sharing overview stays, and 全部类型 stays the fold's last row. |
| The first reading of the table: a `datasource` row opens Setup's Datasources page | Replaced: the menu draws no `datasource` row. |
| TL;DR 4 and its row in the 2026-11-24 table: `dataset` is a `ui` type | Replaced for `dataset`. `dashboard` and `report` stay `ui` types; the Analytics split is still not made. |
| Item 1 of the 2026-11-24 list: the cross-package directory is entered from 访问 Access | Replaced by decision 12: it leaves the menu. In force until it moves. |
| [#36501](https://github.com/objectstack-ai/objectstack/issues/36501): the package switcher removed | Reversed. |
| [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) D1 | Marked the same day, in two places: its scope sentence, and what it gave Studio that decision 12 moves to Setup. The rest of D1 stands — Studio owns the metadata, Setup administers, the item tools are Studio's, one save model. |
| ADR-0146 D3: a pair is folded under its base in the switcher; pending changes and publish act on the pair | Stands. Not edited. |
| [ADR-0070](./0070-package-first-authoring.md) D1–D6 | Not edited. Question 1 is open. D1 and D5 are restated by the ruling under [Organization-level content](#amendment-2026-11-26-org), and the phase-4 cards mark them. |
| [ADR-0159](./0159-forms-are-their-own-metadata-type-public-forms-are-form-items-view-is-lists-only.md) D10: "ADR-0084 needs no change" for `form` | Written before the type → group table took one pinned row per type. `form` now needs a row, and this amendment says where it goes. ADR-0159 is not edited. |

### Open on #37424 — not decided here {#amendment-2026-11-26-open}

Five questions were put to the maintainer on the epic ([comment 7184108099](https://github.com/objectstack-ai/objectstack/issues/37424#issuecomment-7184108099)). Questions 2 and 3 are ruled, and are written under [Organization-level content](#amendment-2026-11-26-org). Questions 1, 4 and 5 are open, and they keep their numbers here. None blocks the first phase. This record takes no side on any of the three. Each line says what is asked and what is in force until the answer; the answer is recorded on #37424 and marked on its line here by the card that carries it out.

- **Question 1 — disable, enable and delete of a package: Setup's, or Studio's?** Decision 1 gives Studio the work on one package, and decision 9 lists these three in 概览's ⋯. They are done in Setup → Packages today, where the maintainer's ruling of 2026-10-30 put the module switch (「大包 + 设置里启用模块」, [#28117](https://github.com/objectstack-ai/objectstack/issues/28117); ADR-0070 D2 as amended). Until the answer they stay in Setup, the ⋯ menu keeps its "Manage in Setup…" row, and ADR-0146's split is not edited on this point. Asked before phase 2.
- **Question 4 — do `dataset` and `position` join the 常用 types?** Decision 6 places both there. Each sits ill with a test of the 2026-11-25 rule: a dataset's schema requires one object (the first test), and a position is one slot per name in the environment, not in the package (ADR-0150 D7; the third). The rule allows the answer — "where the maintainer places a type by name, the name decides" — so a yes is two named placements beside `picklist` and the three AI types, and the rule stands. Until the answer both are 高级. Asked before phase 3.
- **With question 4 — is `form` a 常用 type?** The area that owns the epic recommends it. A form is bound to one object (ADR-0159 D2), so the same first test sorts it 高级, and a 常用 `form` is a third placement by name. If the answer is yes, `form` is the fifth 常用 type of 界面 UI, after `report`, because a group's 常用 types are listed before its 高级 ones. Until the answer it is 高级, directly after `view`.
- **Question 5 — which Setup group holds the cross-package environment directory?** Decision 12 says Setup → Diagnostics, beside the audit log. What the directory lists is access metadata, and the question is whether its place is there or with Setup's access pages. Until the answer it stays where it is, entered from 访问 Access. Asked before phase 3.

Also not decided here, and not yet a question: on 概览 of a read-only package with a pair, which of the two Export, revert and the history act on; where a person lands after disabling or deleting the package they have open; and 概览's address, which is not a metadata address because a package is not an item. The card that builds each brings a ruling if it needs one.

### Written here where the rulings were silent (for the approver's merge) {#amendment-2026-11-26-silent}

Merging accepts them; an objection names the number.

1. **Where 概览 sits.** Decision 6 says it is the first entry. Written here: above the six groups, under no group and in no tier, drawn on every package and never folded. The package-less scope (`~org`) and the cross-package leg (`~all`) open no package and draw no 概览.
2. **What the package row names.** The 2026-11-24 ruling stands: the open package is named by its app where it publishes one, and by its own name where it does not. The switcher's rows are named the same way. Decision 8 speaks of "the app name in the switcher row", which agrees.
3. **What the switcher lists, and where it lands.** It lists packages and nothing else: a pair is folded under its base, and `~org` and `~all` are not rows of it. Picking a package opens that package's 概览. Weighed and not taken: the list of the type the person was on, which the other package may not hold.
4. **Below 768 px.** The menu is a drawer there, and something must open it. "No top bar" is read as from 768 px up, the way ADR-0146 D5's note reads the app's shell. Below that width the frame keeps what the app's shell keeps: a strip that holds the control which opens the drawer.
5. **The top bar's seventh tenant.** For a package with no app, the bar draws a "create app" button, or a label that says the app waits for a publish. No ruling gives them a home, and this record gives them none. 应用 `app` is a 常用 row, drawn "whether the package holds one or not, so a package without one still shows where the first is made" (2026-11-25), and an app that waits for a publish is counted on Pending. They go with the bar.
6. **Save and Cancel on a page that saves and is not an item.** The pick puts them in the item's header. A page with unsaved edits and no item header — the default sharing overview is one — carries them at the right end of its own title row.
7. **Diagnostics, set beside the ruling of 2026-10-30.** ADR-0146 D1 gives Studio "diagnostics", on the maintainer's words of that day about the catalog, source, layers, history and diagnostics: 「我认为还是应该在 studio」. Decision 12 moves the Diagnostics page to Setup, on 「同意」, and the epic does not set the two side by side. This record takes the later word, for that page alone: what an item's own list row and page say about its validation stays in Studio. If the earlier ruling is meant to hold, Diagnostics keeps its row in 平台 Platform, and the words to change are its line under [Placements](#amendment-2026-11-26-moves) and ADR-0146 D1's mark. The same care applies to the cross-package directory, against D1's "Setup carries no metadata editor and no metadata catalog": decision 12 moves it, its group is question 5, and that answer can weigh this too.
8. **The order around `dataset`.** Decision 6 says "directly after object". Written here: second in 数据 Data, each type after it one place later, and 界面 UI closed up behind it. The order holds whichever tier question 4 gives it.
9. **Decisions written here beyond the card's list.** Card #37451 names decisions 1–6 and 9–10 as ruled inputs. This record also writes decision 8, because the lock is part of the row #37456 builds, and decision 12's moves, because the card asks for every phase to be written once. Decision 7, the list page's look, is not information architecture and is left to its card. Decision 11 is written as ruled on questions 2 and 3, the same day.
10. **English names.** The maintainer's words are Chinese: 概览, 新建软件包, and the tabs 信息 · 待发布 · 发布历史. This record writes Overview, New package, and Info · Pending · Publish history.
11. **Where `form` goes.** The maintainer asked how the type is planned for the menu, and has not placed it. Written here from what is already ruled: its group is its registered domain, `ui` (ADR-0159 D2); its tier is the first test's, 高级, as for `ai_context`, because a form is bound to one object. Its place inside the group is not ruled, and this record puts it directly after `view`, the type it was carved from, ahead of `action`. The owning area recommends 常用; that is the maintainer's to say, and it is asked with question 4.

Refs: epic [#37424](https://github.com/objectstack-ai/objectstack/issues/37424) (the quotations, decisions 1–12; the phase table and questions 1–5, comment 7184108099; the ruling on questions 2 and 3, comment 7184753035; the mockups, [comment 7181963746](https://github.com/objectstack-ai/objectstack/issues/37424#issuecomment-7181963746)); card [#37451](https://github.com/objectstack-ai/objectstack/issues/37451) (this amendment; the pick and the five homes; the question on `form`, comment 7184972402); [#37452](https://github.com/objectstack-ai/objectstack/issues/37452), [#37454](https://github.com/objectstack-ai/objectstack/issues/37454), [#37455](https://github.com/objectstack-ai/objectstack/issues/37455), [#37456](https://github.com/objectstack-ai/objectstack/issues/37456) (the first phase); [#37453](https://github.com/objectstack-ai/objectstack/issues/37453) (the readings on package-less writes); [#37086](https://github.com/objectstack-ai/objectstack/issues/37086) and [#37087](https://github.com/objectstack-ai/objectstack/issues/37087) (the `form` type and its designer); [#36501](https://github.com/objectstack-ai/objectstack/issues/36501) (the switcher's removal, reversed); epic [#36510](https://github.com/objectstack-ai/objectstack/issues/36510) (the save rule); [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) D1, D3 and D5; [ADR-0070](./0070-package-first-authoring.md) D1, D2, D5 and D6; [ADR-0150](./0150-behavioural-metadata-addressed-by-package-objects-keep-the-literal-prefix.md) D1 and D7; [ADR-0159](./0159-forms-are-their-own-metadata-type-public-forms-are-form-items-view-is-lists-only.md) D2 and D10.
