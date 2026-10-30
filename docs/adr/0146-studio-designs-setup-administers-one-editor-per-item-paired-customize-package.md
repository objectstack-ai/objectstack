# ADR-0146: Studio designs, Setup administers — one editor per metadata item, the whole metadata catalog in Studio, and a paired `<base>.customize` package for every installed base

**Status**: Proposed (2026-10-30) — drafted on the maintainer's instruction in the project decision thread
「决定 Studio 建议三行的产品取舍」: 「按照这个方案先更新 issue，写adr。等我审核」. Awaiting the maintainer's review and
hand-merge, which is the acceptance act for a governed surface (Prime Directive #14). ⛔ Nothing in this record is in
force until it merges; **this record declares and implements nothing** — the implementation is cut as cards after the
merge ([Rollout](#rollout)).
**Decided by**: the maintainer's rulings in that thread, 2026-10-30T10:04Z–10:28Z, verbatim and untranslated, each
quoted at the decision it fixes. **Provenance a repository reader can reach**: the three row rulings (12 B, 14 C,
19 A1) and the D4–D6 quotes are on the card as ruling record
[`6520616687`](https://github.com/objectstack-ai/objectstack/issues/27356#issuecomment-6520616687); the D1–D3
boundary quotes were spoken in the project thread and have **no GitHub record** — the maintainer's hand-review and
hand-merge of this record is their verification. The thread's full analysis lives in the project's own files, outside
this repository. The rows are [#27356](https://github.com/objectstack-ai/objectstack/issues/27356) rows 12, 14 and 19
(HotCRM's 18.2.0 browser pass, hotcrm#2320 Studio report S1 / S3 / S8).
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (the overlay tier and its five types),
[ADR-0070](./0070-package-first-authoring.md) (every authored item lives in a writable package; D3 "pick or create a
base first"; D5/D6 retire the package-less scope and forbid an org dumping ground),
[ADR-0126](./0126-packaged-metadata-customization-model.md) (three regimes; the activation ledger
`sys_metadata_activation`; §7 flows; §9 what is deliberately not tracked),
[ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) D6 (managed install = sealed definitions +
the regimes), [ADR-0010](./0010-metadata-protection-model.md) (the protection envelope a packaged item carries),
[ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md) D7 (navigation contributions — the
*contributed item* this record presents; the greyed-with-source presentation is this record's own, see [D3](#d3)),
[ADR-0141](./0141-inter-app-dependency-declared-checked-before-install.md) (`manifest.dependencies`, checked before
install, the namespace it shares co-owned — the dependency [D3](#d3)'s paired package declares),
[ADR-0142](./0142-ownership-queue-membership-claim-and-assignment-rules.md) D2 (queue membership through the existing
recipient kinds — the queue page [D7](#d7) waits for).
**Governs**: the console's two authoring surfaces in `ui/packages/app-shell` — Studio (`views/studio-design/**`,
`hooks/useStudioDesignGate.ts`, the app → Studio bridge in `layout/`) and Setup (`views/metadata-admin/**`,
`views/setup/**`); the package create door and the flow clone door (`packages/runtime`, `packages/metadata-protocol`);
the QA checklist entries that drive the Setup designer as a door (`docs/qa/platform-checklist/areas/studio-authoring.json`
and neighbours). ⛔ It does not change the metadata type registry, the overlay tier's membership, the activation ledger's
shape or any write door's authority — those are ADR-0005 / ADR-0126 / ADR-0131 and stand.
**Consumers**: `domain:ui` seats (Studio and Setup cards), `domain:server` seats (the two doors in [D3](#d3) and
[D4](#d4)), the QA checklist maintainers, `content/docs` (the "install, then customize in Studio" promise ADR-0126 §1.3
names).

---

## Context

Measured on `origin/main` `f8633c7c` (2026-10-30), code read, not run.

1. **Two editors per item.** Studio is four pillars (Data, Interfaces, Automations, Access) that design **7** metadata
   types (object, view, page, dashboard, report, flow, permission set) — plus a create dialog, with no designer, for
   `dataset` (`datasetCreate.tsx`, from the report and widget pickers) — working per package with drafts and a publish
   review (ADR-0070). Setup → Metadata ("All Metadata Types", `views/metadata-admin`) is the registry's catalog: its
   directory shows the types the active package contributes, hiding `field` and `package` (`HIDDEN_TYPES`), and opens
   every item in one generic page (`ResourceEditPage`: schema form, Source JSON, layered code / overlay /
   effective diff, history, diagnostics, reset or delete) that saves at once. For the 7 pillar types the same item has
   two designers with two save models. HotCRM's browser pass named it (#27356 row 19: "Studio and Setup → Metadata each
   open a designer for the same flow or view; only Setup can delete a flow or reset an overlay").
2. **The registry's tiers** (`DEFAULT_METADATA_TYPE_REGISTRY`, `packages/spec/src/kernel/metadata-plugin.zod.ts`):
   30 types; **5** take an environment overlay (view, dashboard, report, translation, email_template — ADR-0005);
   **9** are code-only (`allowRuntimeCreate: false`: field, picklist, job, agent, api, capability, queue,
   assignment_rule, sharing_rule); the rest are runtime-creatable into a writable package only.
3. **The gates differ.** Studio's authoring entries read `manage_metadata` (`useCanAuthorMetadata`; the trail
   capabilities are `studio.access` and `manage_metadata`, `setup.access` no longer opens them). Setup reads
   `setup.access`; delegated administrators reach positions, permission sets and membership through Setup.
4. **The app → Studio bridge skips code packages.** `useStudioDesignGate` draws "Edit {app} in Studio" (app switcher,
   app bar pencil) only for a package Studio lists as `writable` (objectui#12615: "Studio opened a read-only package in
   its browse-only posture with nothing to edit, so an entry drawn there promised an edit Studio cannot deliver"). On a
   deployment whose apps are all code packages the bridge never draws (#27356 row 12). *Overtaken while this record was
   in review*: PR [#28076](https://github.com/objectstack-ai/objectstack/pull/28076) implements [D5](#d5) and was
   seat-accepted on 2026-10-30; the reading above is true at `f8633c7c` and false once it merges.
5. **Operational switches live only in Setup.** ADR-0126 §7.4 placed the packaged-flow toggle (the
   `sys_metadata_activation` bit, `POST /api/v1/automation/<name>/toggle`) and the clone
   (`POST /api/v1/automation/<name>/clone`) on Setup › Packaged automation, whose file's doc comment states the charter: "Automation
   AUTHORING lives in Studio and stays there. This page is the OPERATIONAL surface". Studio's own Enabled switch is a definition
   write (`status`), refused on a read-only package and since #27376 drawn muted with a lock. So an administrator looking
   at HotCRM's flow in Studio cannot switch it off or clone it there.
6. **A clone lands package-less.** `packages/runtime/src/flow-clone.ts` drops the package envelope; the copy is "a flow
   authored in this deployment" and shows in Studio's package-less "Organization flows" scope (objectui#11553) — the
   scope ADR-0070 D5 retires.
7. **Setup's metadata pages carry administration.** Two live sections sit inside Setup's metadata item pages today:
   position holders (`PositionHoldersSection`, "Position → Add holder") and permission-set assignment
   (`AssignedUsersSection`); #27356 rows 1, 2, 5 and 9 are about those pages. Queue membership has **no** Setup page or
   section at this head — ADR-0142 D2 (Proposed) defines it through the existing recipient kinds, and its page arrives
   with that record's landing.

The question the maintainer put was not "which rows to take" but where the line between the two surfaces runs:
「Setup → Metadata 你说的是一个菜单入口吧，这些应该都属于元数据，是否建议都归 studio，是给开发人员用的， setup 时给管理员用的。」

## Decision

### D1 — Studio owns all metadata; Setup owns the deployment's administration {#d1}

**Studio = the developer's surface: design, catalog, source, layers, history, diagnostics — all 30 types.** The four
pillars stay the designers for the types they cover; an **"All metadata"** area joins them, per package and across
packages, holding what `views/metadata-admin` holds today: the type directory, lists, the generic item page (schema
form, Source JSON, layered code / overlay / effective, history, diagnostics, reset / delete). A pillar type opened from
the directory opens its pillar.

**Setup = the administrator's surface: people and organization, assignments, runtime configuration, operations.**
Users, organizations and business units, roles, position holders, permission-set assignment, queue membership,
delegated administration; datasources, system settings, app installation and marketplace, licences; deployment-wide
operational overviews (packaged automation, jobs, a diagnostics summary). **Setup carries no metadata editor and no
metadata catalog.** The "Setup → Metadata" routes retire behind redirects into Studio once [D7](#d7) has landed.

Maintainer, verbatim: 「我认为还是应该在 studio」 (on the catalog, source, layers, history and diagnostics);
「studio 是给开发人员用的， setup 时给管理员用的」.

Not taken: (a) *Setup keeps the catalog as the "environment view" and Studio keeps the pillars* — the thread's first
proposal; the maintainer ruled the catalog's tools (source, layered diff, history, diagnostics) are a developer's, not an
administrator's, and keeping them in Setup leaves two homes for one item. (b) *Everything metadata-shaped into Studio
including the administration reached through metadata pages* — rejected by [D7](#d7): holders, assignments and
membership are administration and get Setup pages of their own.

### D2 — One editor per item: an item is edited where it lives {#d2}

- A **writable package's** item is edited in Studio's pillar (as today).
- A **read-only package's** item of an overlay type (the five of ADR-0005) is edited **in place, on that package, in
  Studio**: the pillar opens the item, the draft writes the overlay layer, publish applies it; the item header carries a
  "customized in this environment" chip and a **Reset to package default** (the same `DELETE /meta/:type/:name` the
  Setup page issues, with the ADR-0126-era honest verb from the layered read's `resettable`). The chip states overlay
  presence, a fact the layered read already serves — ⛔ not clone lineage, which ADR-0126 §9 does not track.
- A read-only package's item of any other type is **viewed** in Studio (the browse-only posture) and edited nowhere;
  additions go to the paired package ([D3](#d3)).
- No second editor exists for any item: Setup's per-item designer routes for the pillar types stop being editors
  ([D1](#d1)); the "Read-only · Customize with an overlay" link that today sends Studio to Setup (#27927, row 13) is
  the transitional form and retires with Phase 2.

**What this lifts from ADR-0126 §9, stated so the two records cannot be read as disagreeing.** §9's first bullet
deferred "the ServiceNow-style overlay layer (badge / customization list / diff-vs-base / revert / upgrade skip-report)
… **if** customer pull for in-place customization appears". That pull is now on record (HotCRM's pass, #27356 rows 12,
13, 19; the maintainer's 「或者直接在只读包上做叠加的覆盖管理」), and this record charters **three of the five** on facts the
platform already serves, with nothing computed: the **badge** (the "customized" chip = overlay presence in the layered
read; the "customization" chip in [D3](#d3) = the item's package), the **customization list** ([D3](#d3)'s "only
customizations" filter and the landing's per-package count of overlaid and switched-off items — a filter over served
rows and a count of ledger rows) and **revert** (Reset = the existing `DELETE /meta/:type/:name` on the overlay row).
**Diff-vs-base and the upgrade skip-report stay deferred**, and §9's second bullet — no clone provenance, no base-moved
notice — stands untouched. At acceptance, ADR-0126 §9's first bullet takes the pointer to this record.

Maintainer, verbatim: 「或者直接在只读包上做叠加的覆盖管理」.

Not taken: a separately selectable **virtual package** standing for "this environment's customization layer" as a
Studio scope — 「代码包只读，覆盖的部分是否建议单独选中一个虚拟包代表自定义层，还是维持 studio 的风格？」. An overlay
is a layer on one item of one package; a scope that collects overlays detaches them from their context and is the
org-level dumping ground ADR-0070 D6 forbids. The word "virtual" survives only as presentation in [D3](#d3).

### D3 — Every installed base gets a paired customization package, `<base>.customize`; Studio shows the pair as one surface {#d3}

**Underneath, a real package.** ADR-0070 D1 holds: a new flow, view, page or permission set the customer adds "to
HotCRM" lives in a writable package. That package is **`hotcrm.customize`** — an ordinary writable package that
declares a dependency on `hotcrm` in `manifest.dependencies` (ADR-0141: checked once before install; the paired package
shares the base's namespace by construction and co-owns it under that record's rule), created on the customer's first
addition to the base **without a package prompt**, one per base, never one per environment. **This amends ADR-0070 D3
for the paired case**: D3 forbade the *silent catch-all* (`com.workspace`, the package-less scope) and left a prompted
one-click auto-provision open (ADR-0070 open question 1); a deterministic, per-base, dependency-declaring target is
neither a catch-all nor silent about where the item went — the item header's chip and the folded switcher say it — so
the prompt is dropped for this one case and stays everywhere else D3 names. It receives: new items authored from the base's Studio surface, **clones** of the base's flows
([D4](#d4)), and environment-level permission sets for the base. It is published, reviewed, duplicated and deleted as any
writable package is today, and exported as ADR-0070 D4 lands (the export door is not on the REST ledger at this head);
upgrading the base never touches it; ADR-0070 D6 is satisfied (one per base, not a bucket).

**On top, one surface.** Studio opens HotCRM and the designer sees **one** HotCRM: the pillar rails list the base's
items (read-only; the overlay types editable in place per [D2](#d2)) and the customize package's items (writable)
**in the same list**, the latter marked with a small "customization" chip and filterable with "only customizations";
New and Clone land in the customize package without asking; the pending-changes and publish surfaces act on the
customize package; the package switcher folds `hotcrm.customize` under HotCRM instead of giving it a row. Items another
package contributes to the base (flows watching its objects, fields extending its objects, ADR-0029 D7 navigation
contributions) are listed **greyed, with their source package named** — a presentation this record decides (ADR-0029
D7 defines the contribution, not how a contributed item is drawn; #26889 and #27928 are the row-20 precedent).

**Upgrade and audit.** "What did we change on HotCRM" is one place: `hotcrm.customize` plus the base's overlays and
switched-off items. Studio's landing carries one line per package ("n customized, m switched off"); Setup carries
nothing per package.

Maintainer, verbatim: 「假设未来客户安装了很多软件包，对具体软件包的定制岂不是在 软件包中直接看更方便，如果在setup，都
混在一起了。」; 「流必须住在可写包里（ADR-0070），能否虚拟一个 hotcrm.customize 包，但是设计者看的时候应该在一个及诶慢。」 (verbatim; the last
word is a typing slip for 界面, "one interface" — editorial note, not part of the quote)

Doors this needs (server cards, Phase 2): the package create door accepts the pairing convention (name
`<base>.customize`, dependency on the base, idempotent "create if absent"); the flow clone door takes a target
`packageId` and refuses a package-less target once the convention exists (fixing the Context §6 mismatch with ADR-0070
D5 on the way).

### D4 — The operational switches are offered on the item in Studio; Setup keeps the deployment-wide overview {#d4}

ADR-0126 §7.4 chose Setup as the first surface for the packaged-flow toggle and clone; that was a surface choice
(its Fork D), not one of the §9 walls. This record moves the primitives to where the item is:

- In Studio, on a **read-only package's flow**, the Enabled switch binds the **activation ledger**
  (`GET /api/v1/automation/_status`, `POST /api/v1/automation/<name>/toggle`) and reads "off for this deployment"; on a
  **writable package's flow** it stays the definition switch ("disabled; publish to apply"). Two switches, two words —
  never one control that means different things by package.
- **Authority is the ledger door's, not Studio's.** The toggle's gate (`packages/runtime/src/domains/activation-gate.ts`)
  admits `manage_metadata` in the `single` posture and, under the walled `group` / `isolated` postures, only the
  PLATFORM_ADMIN posture rung (ADR-0126 §5); a tenant administrator there is refused with the operator's name. Studio
  draws the ledger switch **disabled, with that refusal as its title**, for a principal the gate would refuse — never a
  live control that always answers 403 (the shape `useCanReadTrail` already avoids).
- The item's ⋯ menu offers **Clone** (`POST /api/v1/automation/<name>/clone`, a new machine name required, the server's
  notice shown verbatim with the "switch the original off" offer, objectui#13270's shape); the clone lands in the
  paired package ([D3](#d3)).
- Setup › Packaged automation becomes a deployment-wide **operations overview** (which packaged flows are off, which are
  "not running here" and why); it stops being the only door. Whether it stays or retires is decided on usage after
  Phase 2, not here.
- ADR-0126 §9's second bullet stands: no lineage from a clone to its source, no diff against the base, no "based on
  vN" notice, on either surface. Its first bullet is lifted in part by [D2](#d2), as stated there.

Maintainer, verbatim: 「打包自动化开关，这个就很奇怪，正常的操作我应该是在studio中进入 hotcrm app，选中一个流程，点禁用或者
复制更符合逻辑吧？」

### D5 — The app → Studio bridge draws for a read-only package, as a browse entry {#d5}

objectui#12615's reasoning ("a pencil promised an edit Studio cannot deliver") rules out the **pencil**, not the
**entry**. For a read-only package the app switcher row and the app bar entry draw as "Open {app} in Studio" (an eye,
not a pencil; zh 「在 Studio 中查看 {app}」), for the same principals through the same gate (`useStudioDesignGate`
answers a posture, ⛔ still never a second derivation of `writable`); a writable package keeps "Edit {app} in Studio".
Kernel packages and an unread or failed package list still draw nothing. (#27356 row 12, letter B.)

Maintainer, verbatim: 「「Edit {app} in Studio」代码包/已安装包一律不画，合理吗？ai写完代码，人类需要进去确认啊」.

### D6 — Not done, recorded so silence cannot be read as consent {#d6}

- **No fields table in the object designer** (#27356 row 14, letter **C**, maintainer 2026-10-30T10:07Z). The Records
  grid's columns and the Form canvas each enumerate every field and open the one field inspector; objectui#5813 ("a
  separate fields tab would ADD a surface, not remove one") and objectui#12450 (seven flat tabs, decision B of
  objectui#12446) stand. Maintainer, verbatim: 「Studio 的对象设计器，第一栏数据不就是每一个字段吗？表单对应的不也是每一个
  字段吗」.
- **No Setup designer for any type**, transitional redirects excepted ([D1](#d1)).
- **No global customization scope** ([D2](#d2), not taken).
- **No change to the overlay tier's membership** (the five types) or to the activation ledger's shape (ADR-0005,
  ADR-0126).

### D7 — Setup pages the move owes {#d7}

Administration reached through Setup's metadata pages today gets a page of its own under Setup before those routes
retire: **position holders** (`PositionHoldersSection`) and **permission-set assignment** (`AssignedUsersSection`) are
the two live sections the move re-homes; **queue membership** has no section at this head and arrives as a Setup page
with ADR-0142 D2's landing, never inside a metadata page. Each is a people-and-organization page (the scope of
`setup.access` and the delegated-administrator gate), not a metadata page. ⛔ Phase 3 does not retire a
Setup → Metadata route whose administrative action has no Setup home yet.

## Consequences

- One editor per item; the HotCRM pass's "two designers, two save models" disappears, and every future type answers
  "where is it edited" by rule instead of by card.
- An administrator does not learn Studio for the daily work; a developer does not enter Setup to change a design. The
  one recorded crossing: **defining** a permission set (as against assigning one) is design and happens in Studio's
  Access pillar, in the paired or the writable package, behind `manage_metadata`.
- The clone's landing moves from the package-less scope to the paired package, which closes the Context §6 gap with
  ADR-0070 D5.
- Cost, stated: Setup's item pages for the pillar types stop editing; QA checklist items and e2e specs that drive the
  Setup designer as "a sibling door onto the same save" (`studio-authoring.json`, `ux-conventions.json`, the live
  `studio-object-designer.spec.ts`) are rewritten to the Studio door or marked transitional; users used to editing a
  view in Setup change habit. Translations and email templates lose the Setup form; their simplified form editor is
  offered inside Studio's All-metadata area ([Open questions](#open-questions) 3) — which is the **second** recorded
  crossing: an administrator changing one line of mail copy enters Studio, behind `manage_metadata`, as the
  permission-set definer does.

## Rollout

Cut as cards after this record merges; nothing below binds a seat before that. Each card cites this record.

1. **Now** (#27356 row 19, letter **A1**, independent of this record): Studio deletes a writable package's flow from
   the Automations item menu (confirm; the same `DELETE /meta/:type/:name` door; a pending draft of the item is
   discarded first; read-only packages draw nothing).
2. **Phase 2 — customization on the read-only package** (ui + two server doors): (a) in-place overlay editing, the
   "customized" chip and Reset on read-only packages ([D2](#d2); views, dashboards, reports first); (b) the ledger
   switch and Clone on the item ([D4](#d4)); (c) the clone door's `packageId`; (d) the paired-package create
   convention and dependency ([D3](#d3)); (e) the mixed rails, the chip and filter, the folded switcher ([D3](#d3));
   (f) the browse entry ([D5](#d5)) — #27356 row 12, PR #28076, seat-accepted 2026-10-30; it reverses no wall and lands
   ahead of this record.
3. **Phase 3 — the catalog moves** ([D1](#d1), [D7](#d7)): `views/metadata-admin` directory, lists, item page,
   history and diagnostics re-homed under Studio's All-metadata area (per package and across packages); the three Setup
   administration pages; Setup → Metadata routes redirect; QA checklist and e2e door rewrites.
4. **Phase 4 — as pulled**: app, action, dataset (today a create dialog, no designer), translation, email template,
   documentation and the AI types gain pillar-grade designers in Studio one card at a time; until then the All-metadata
   area's generic page is their editor.

## At acceptance

When this record is accepted, the pointers go on the records it amends, in the repository's status-line form
(ADR-0005's is the model): ADR-0126 §7.4 and §9 (first bullet), ADR-0070 D3 (the paired case) and D5 (the clone's
landing), ADR-0029 D7 (the greyed-with-source presentation is this record's). Not owed while Proposed.

## Open questions (for the maintainer's review of this draft)

1. Setup › Packaged automation after Phase 2: keep as the operations overview, or retire.
2. The pairing name: `<base>.customize` as the maintainer spelled it, or another suffix; whether the convention is a
   registry constant or a server-side default the create door applies.
3. Translations and email templates: keep a simplified **form** editor for their overlays inside Studio's All-metadata
   area (the former Setup form, re-homed), so an administrator changing one line of mail copy is not sent to a canvas.
   Recommended yes; the rule "one editor per item" still holds because the pillar does not edit these types.

## Refs

- [#27356](https://github.com/objectstack-ai/objectstack/issues/27356) rows 12, 13, 14, 19, 20, 21 and their landed
  PRs #27376 (read-only flow switch), #27927 (overlay link only where an overlay exists).
- ADR-0126 §7.4 (the Setup surface this record moves from) and §9 (first bullet lifted in part by D2; second bullet
  kept); ADR-0070 D1, D3 (amended for the paired case by D3), D4, D5, D6; ADR-0005; ADR-0131 D6; ADR-0141; ADR-0142 D2.
- objectui#12615 (bridge follows package posture), objectui#5813 and objectui#12450 (the Data pillar's tabs),
  objectui#11553 (the package-less scope), objectui#13270 (the clone result's offers).
