# ADR-0146: Package-level override — every customization of an installed package lives in its paired `.custom` package, through one declared override shared by code and Studio; Studio designs, Setup administers

**Status**: Accepted (2026-10-31) — rewritten in place from the Proposed draft of 2026-10-30 (PR
[#28045](https://github.com/objectstack-ai/objectstack/pull/28045), hand-merged 2026-10-30 13:55Z; the replaced D2–D4
are readable in that PR's file) on the maintainer's instruction, verbatim: 「adr 146还没开始开发，可以直接改」 (2026-10-30, recorded on epic
[#28236](https://github.com/objectstack-ai/objectstack/issues/28236)). The decision is the maintainer's rulings of
2026-10-30 and 2026-10-31, quoted verbatim and untranslated at each point they fix; the maintainer's hand-merge of this
rewrite is the acceptance act for a governed surface (Prime Directive #14), and the record is in force from that merge.
**This record declares; it implements nothing** — every mechanism below is cut as a card of epic #28236 after the merge
([Rollout](#rollout)). It **supersedes in part** ADR-0126 D1, D4 wall 1 and §7.1's same-name prohibition, ADR-0131 D6,
ADR-0005's five-type tier, ADR-0048 §3.3 and §3.4 (inside a base's dependency closure), ADR-0141 D3's uninstall item and ADR-0070 D3/D5 for the paired case, and
**amends** ADR-0009 (the resume reading of `executionPinned`) and ADR-0029 D7 — each clause quoted in the
[Supersede table](#supersede-table), each record's Status line carrying the dated pointer. The 2026-10-30
draft's D1, D5, D6 and D7 stand as written; its D2 (in-place overlay editing) and D3 (`<base>.customize`) are replaced
here, and its D4 keeps the ledger switch and loses the clone. · **Amended in place** (2026-10-31, ruling **A** on
decision card [#28390](https://github.com/objectstack-ai/objectstack/issues/28390), ruling record
[`6542177429`](https://github.com/objectstack-ai/objectstack/issues/28390#issuecomment-6542177429), maintainer, verbatim:
「同意」): only the paired `<base>.custom` declares an override — the rider of ruling record 6540351677 that opened the
declaration to any package in the closure is withdrawn, and a dependent's same-named item has one fix, rename ([D2](#d2),
[D8](#d8), [D9](#d9)); `basedOn` records the base package's `manifest.version` (ruling record
[`6549129352`](https://github.com/objectstack-ai/objectstack/issues/28404#issuecomment-6549129352) on #28404, follow-up c);
[D9](#d9)'s `action` paragraph reads the landed ledger switch; the [Consequences](#consequences) carry the base-upgrade
displacement cost. The amendment lands as the rewrite did — by the maintainer's hand-merge of the PR cut from #28390.
**Decided by**: the maintainer, 2026-10-30, in the desktop session that re-planned the epic, verbatim and
untranslated as epic #28236 records them — the direction 「方向定为包级覆盖：代码和 Studio 用同一机制，定制都进 .custom。」; the suffix 「同意 后缀改成 .custom」; the eight questions 「等我拍板的 8 个问题，全部同意」; the extension
fields 「扩展字段用 __c 后缀，只有 .custom 包能用。」; the item toolbar 「同意新增 2h「Studio 项工具栏」并放在 2a 之前」;
the Setup item tools 「setup 右侧这套界面，包括看版本历史的，本身就应该属于 studio」; the sequence 「我建议先等包级覆盖开发完，再考虑这个界面的修改」 and 「四个小问题 同意」; the fleet 「这些卡都可以放回车队开发吧」 · 「注意不能写epic车队才会认领」 (2026-10-31); the scope of Q1's refusal and `action`, 2026-10-31, on decision card [#28364](https://github.com/objectstack-ai/objectstack/issues/28364) (ruling record [`6540351677`](https://github.com/objectstack-ai/objectstack/issues/28364#issuecomment-6540351677)) — 「看的东西（视图、页面、报表、仪表盘），扩展包中不能覆盖吗？视图类和流程动作类有什么区别嘛」, 「没写这行声明、又恰好同名，是否建议统一规则，要么申明覆盖，要么禁止。这样会有什么坏处吗」, then 「同意」 to the uniform rule inside the dependency closure and to `action` following its ledger switch ([D2](#d2), [D9](#d9)). The 2026-10-30 boundary rulings the draft recorded (D1, D5, D6, the pairing idea under D3) are kept
where they are quoted. **Provenance a repository reader can reach**: epic #28236's body and its checklist
[`6530771225`](https://github.com/objectstack-ai/objectstack/issues/28236#issuecomment-6530771225); the row rulings of
the browser pass on [#27356](https://github.com/objectstack-ai/objectstack/issues/27356) as ruling record
[`6520616687`](https://github.com/objectstack-ai/objectstack/issues/27356#issuecomment-6520616687); the measurements on
[#28238](https://github.com/objectstack-ai/objectstack/issues/28238), [#28148](https://github.com/objectstack-ai/objectstack/issues/28148)
and [#28149](https://github.com/objectstack-ai/objectstack/issues/28149). The re-plan's own discussion has **no GitHub
record** beyond the epic's quotations — the maintainer's hand-review and hand-merge of this rewrite is its verification.
**Supersedes in part**: [ADR-0126](./0126-packaged-metadata-customization-model.md) D1, D4 wall 1 and §7.1 · [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) D6 · [ADR-0005](./0005-metadata-customization-overlay.md) the five-type tier · [ADR-0048](./0048-cross-package-metadata-collision.md) §3.3 and §3.4, for a base's dependency closure · [ADR-0141](./0141-inter-app-dependency-declared-checked-before-install.md) D3's uninstall item · [ADR-0070](./0070-package-first-authoring.md) D3's prompt and D5's destination, for the paired case — each clause quoted in the [Supersede table](#supersede-table).
**Amends**: [ADR-0009](./0009-execution-pinned-metadata.md) (the resume reading of `executionPinned` — nothing reversed; [D9](#d9) delivers it) · [ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md) D7 (a contributed item is drawn greyed with its source package named in the base's Studio surface — [D3](#d3)).
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (whole-document customizations; the registry
opt-in — superseded in part here), [ADR-0010](./0010-metadata-protection-model.md) (the protection envelope a packaged
item carries), [ADR-0048](./0048-cross-package-metadata-collision.md) (package id as identity; prefer-local resolution
— §3.3 superseded in part here; the 2026-10-08 addendum's one-name-per-deployment rule for the security catalog, which
[D6](#d6) keeps), [ADR-0070](./0070-package-first-authoring.md) (every authored item lives in a writable package; D3
"pick or create a base first" and D5's migration affordance — superseded in part here for the paired case; D6 retires
the package-less scope),
[ADR-0126](./0126-packaged-metadata-customization-model.md) (three regimes; the activation ledger
`sys_metadata_activation`; §9 — D1, D4 wall 1 and §7.1 superseded in part here, §7.4 moved by [D4](#d4), §9's first
bullet lifted in part by [D2](#d2)), [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) D6 (managed
= sealed definitions; environment scope — the per-organization axis stays retired; D6 superseded in part here),
[ADR-0009](./0009-execution-pinned-metadata.md) (`executionPinned` — made real for `flow` by [D9](#d9); amended, not
superseded),
[ADR-0141](./0141-inter-app-dependency-declared-checked-before-install.md) (the declared dependency the paired
package carries; its D3 uninstall item superseded for the paired case by [D3](#d3)),
[ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md) D7/D9 (contributions; the extension
layer [D10](#d10) rides on; D7 amended here — a contributed item is drawn greyed with its source named, [D3](#d3)), [ADR-0142](./0142-ownership-queue-membership-claim-and-assignment-rules.md) D2 (queue
membership — the Setup page [D7](#d7) waits for).
**Governs**: the override declaration and the pairing constants in `packages/spec`; the metadata write and read doors
in `packages/metadata-protocol` (`packages/metadata-protocol/src/protocol-environment-rows.ts`,
`packages/metadata-protocol/src/protocol-packaged-base-refusal.ts`, `packages/metadata-protocol/src/protocol-authoring-gate.ts`,
`packages/metadata-protocol/src/protocol.ts`); the package and automation doors in `packages/runtime`
(`packages/runtime/src/domains/packages.ts`, `packages/runtime/src/domains/automation.ts`,
`packages/runtime/src/flow-clone.ts`); the automation engine's precedence, binding and resume
(`packages/services/service-automation/src/flow-precedence.ts`, `packages/services/service-automation/src/run-resume.ts`,
`packages/services/service-automation/src/engine.ts`); the object extension merge in `packages/objectql/src/registry.ts`;
the console's two authoring surfaces in `ui/packages/app-shell` — Studio (`views/studio-design/**`,
`ui/packages/app-shell/src/hooks/useStudioDesignGate.ts`) and Setup (`views/metadata-admin/**`, `views/setup/**`); the
QA checklist entries that drive the Setup designer as a door (`docs/qa/platform-checklist/areas/studio-authoring.json`
and neighbours). ⛔ It does not change the activation ledger's shape, the tenancy postures, or the organization axis
(ADR-0131 D1/D6 stand: no per-organization override).
**Consumers**: `domain:server` seats (the override core, P1), `domain:ui` seats (Studio and Setup cards), `domain:spec`
(the declaration and constants), the QA checklist maintainers, `content/docs` (the "then customize in Studio"
promise ADR-0126 §1.3 names), HotCRM (the first base a customer customizes).

---

## Context

Measured on `origin/main` `69ce01d7` (2026-10-31), code read, not run, except where a card's own measurement is cited
with its commit.

1. **Two editors per item** (the 2026-10-30 draft's finding, unchanged). Studio is four pillars (Data, Interfaces,
   Automations, Access) that design **7** metadata types — object, view, page, dashboard, report, flow, permission set
   — plus a create dialog, with no designer, for `dataset`, working per package with drafts and a publish review
   (ADR-0070). Setup → Metadata (`ui/packages/app-shell/src/views/metadata-admin/ResourceEditPage.tsx`) opens every
   item in one generic page — schema form, Source JSON, layered code / overlay / effective diff, history with rollback,
   audit, diagnostics, reset or delete — that saves at once. For the 7 pillar types the same item has two designers with
   two save models (#27356 row 19).
2. **The write door seals every item a managed package ships, for every type outside the five-type tier.**
   `packages/metadata-protocol/src/protocol-packaged-base-refusal.ts#refusePackagedBaseOverride` refuses a save onto an
   item the artifact loader registered, `403 NOT_OVERRIDABLE`, with the sentence
   `packages/metadata-protocol/src/packaged-base-regime.ts#managedItemSealedSentence` chooses per ADR-0126 regime; a
   write that names a read-only base answers `ITEM_LOCKED`. The guard is the registry's `allowEnvironmentOverlay`
   alone (`packages/spec/src/kernel/metadata-plugin.zod.ts#allowEnvironmentOverlay`): `view`, `dashboard`, `report`,
   `translation`, `email_template` may be overlaid by an environment row of the same name; every other type's packaged
   item admits nothing but a sibling under a new name. So Studio cannot change HotCRM's flow, and Setup's "customize"
   of HotCRM's view writes a row that belongs to **no package**.
3. **A package-less overlay row does not travel.** The row Setup writes is `sys_metadata` with `package_id` NULL
   (`packages/metadata-core/src/objects/sys-metadata.object.ts`; the uniqueness index
   `packages/metadata-protocol/src/migrations/overlay-index.ts` folds that NULL to `''`). `GET /packages/:id/export` of
   HotCRM does not carry it, no other environment receives it, and nothing in git records it. The 2026-10-30 walkthrough
   that re-planned the epic put it in one line (epic #28236 速读, verbatim): 「Setup 写的是不随包走的「无包覆盖行」」.
4. **A clone double-runs.** `packages/runtime/src/flow-clone.ts` strips the ADR-0010 envelope
   (`packages/spec/src/kernel/metadata-protection.zod.ts#MetadataProtectionFields`) and writes the copy with
   `packages/runtime/src/flow-clone.ts#FLOW_CLONE_STATUS` = `'draft'`, which is a lifecycle label and not an off-switch — its own notice says the copy runs
   beside the original. #28149 measured it at `d6c0a75f1a`: `showcase_urgent_task_alert` and its `_copy` both ran on one
   record change; the copy lands package-less, the scope ADR-0070 D5 retired.
5. **A same-named item in a dependent package silently replaces the base's** (#28238, measured at `d6c0a75f1a`). A
   writable package declaring `dependencies: { "com.example.showcase": "*" }` published a `view` named
   `showcase_task.default` with two columns; `?package=com.example.showcase` served the base's six, the dependent's own
   read two, and the **package-less read and the base app's list served two**, stamped `_packageId:
   com.example.showcase`. Where: `packages/metadata-protocol/src/protocol-environment-rows.ts#packagelessAddress` —
   a package-less read whose stored rows bind exactly one package serves that package's row, and the code package that
   ships the name is not a candidate; reached through `packages/metadata-protocol/src/protocol.ts#packagelessReadAddress`
   and ordered by `packages/metadata-protocol/src/protocol.ts#servedOverlayRowCandidates`. ADR-0048 §3.3 calls the
   context-free read "best-effort"; here it hands the vendor's app to whichever package wrote second, with no
   declaration and no marker.
6. **A flow's armed body is the loader's, and a stored row of its name is shadowed.**
   `packages/services/service-automation/src/flow-precedence.ts#resolveFlowPrecedence` ranks a packaged contender over a
   runtime one within a name the loader's set holds (ADR-0126 §2, "never an overlay read path"), warns once, and never
   dispatches the shadowed body. The remedy it prints is the regime's: clone under a new name, or switch the packaged
   flow off. There is no declared way for a customer's flow to **be** HotCRM's flow.
7. **A suspended run resumes on HEAD, not on the version it started on.**
   `packages/services/service-automation/src/run-resume.ts#resolveResumeTarget` reads `flows.get(run.flowName)` — the
   registered definition by name — and answers `RUN_NOT_FOUND` when the node id no longer exists in it. The engine keeps
   an in-process version list per name and `sys_metadata_history` keeps every version with
   `packages/metadata-protocol/src/sys-metadata-repository.ts#getByHash` (ADR-0009 §2.2), but nothing in
   `packages/services/service-automation/src` reads `getByHash`. ADR-0009 §2.1 pinned `flow` so that "Step executions
   can pause across redeploys"; the resume does not deliver it. Replacing a flow's definition under a suspended run is
   therefore unsafe today, which is why flow customization waits for [D9](#d9).
8. **Object extension exists, at package grain, with no reservation of names.**
   `packages/objectql/src/registry.ts#mergeObjectDefinitions` merges `fields`, `validations` and `indexes` additively and
   lets `label`, `pluralLabel` and `description` override last-writer-wins (ADR-0029 D9.2a's scalar yield aside); the
   declaring shape `packages/spec/src/data/object.zod.ts#ObjectExtensionSchema` is strict with exactly those keys plus
   `extend` and `priority`. Any package may extend any object, under any field name: a vendor's next version can take a
   name a customer's extension already uses.
9. **The paired package's namespace would be derived wrong.** The install primitive
   (`packages/metadata-protocol/src/protocol-package-install.ts#installPackage`) derives a missing `manifest.namespace`
   with `packages/spec/src/kernel/namespace-prefix.ts#deriveNamespaceFromPackageId`, the last dot-segment of the id: for
   `hotcrm.custom` that is `custom`, a namespace no object of the pair may carry and one every customer's `.custom` would
   share. An explicitly declared namespace always wins.
10. **Uninstall reads one relation.** `packages/objectql/src/registry.ts#uninstallPackage` refuses a package whose
    object another package extends (`packages/objectql/src/registry.ts#PackageUninstallExtendedError`, ADR-0029) and
    nothing else; ADR-0141 D3 defers uninstall protection for a declared dependent by name. A base uninstalled under its
    `.custom` would strand every override in it.
11. **The operational switch and the clone live only in Setup** (ADR-0126 §7.4; the 2026-10-30 draft's Context §5):
    `ui/packages/app-shell/src/views/setup/PackagedAutomationPage.tsx` carries the ledger toggle
    (`POST /api/v1/automation/<name>/toggle`, gated by
    `packages/runtime/src/domains/activation-gate.ts#refuseUngrantedActivationWrite`) and the clone. In Studio a
    read-only package's flow shows a locked definition switch beside a status chip that reads the ledger — #28148
    measured them disagreeing (「状态: 已停用 — 不会运行」 next to 「🔒 已启用」).
12. **The app → Studio bridge** draws "Open {app} in Studio" for a read-only package since PR
    [#28076](https://github.com/objectstack-ai/objectstack/pull/28076) (merged 2026-10-30, `6b125a7a`) — the draft's
    [D5](#d5), landed ahead of the record.
13. **Setup's metadata pages carry administration**: position holders
    (`ui/packages/app-shell/src/views/metadata-admin/PositionHoldersSection.tsx`) and permission-set assignment
    (`ui/packages/app-shell/src/views/metadata-admin/AssignedUsersSection.tsx`) render inside item pages; queue
    membership has no Setup page at this head (ADR-0142 D2).

The question the 2026-10-30 draft answered was where the line between Studio and Setup runs. The walkthrough of the
same day asked the prior question — **where does a customer's change to an installed package live** — and the maintainer
answered it for code and Studio at once: 「方向定为包级覆盖：代码和 Studio 用同一机制，定制都进 .custom。」

## Decision

### D1 — Studio owns all metadata; Setup owns the deployment's administration {#d1}

**Studio = the developer's surface: design, catalog, source, layers, references, history with rollback, audit,
diagnostics — all 30 types.** The four pillars stay the designers for the types they cover; an **"All metadata"** area
joins them, per package and across packages, holding what `views/metadata-admin` holds today: the type directory,
lists, the generic item page. A pillar type opened from the directory opens its pillar. **The item tools Setup's right
side offers today belong to Studio, on every pillar item, ahead of any customization work** — maintainer, verbatim:
「setup 右侧这套界面，包括看版本历史的，本身就应该属于 studio」 and 「同意新增 2h「Studio 项工具栏」并放在 2a 之前」
(#28239, N-05). On an item of a read-only package the five tools are read-only: layers, references, history, audit and
source are shown, and rollback, source save, reset and delete are offered only on the writable package open in Studio —
each of those writes a package-less row, and [D11](#d11) closes that write.

**Setup = the administrator's surface: people and organization, assignments, runtime configuration, operations.**
Users, organizations and business units, roles, position holders, permission-set assignment, queue membership,
delegated administration; datasources, system settings, app installation and marketplace, licences; deployment-wide
operational overviews. **Setup carries no metadata editor and no metadata catalog.** The "Setup → Metadata" routes
retire behind redirects into Studio once [D7](#d7) has landed.

Maintainer, verbatim (2026-10-30): 「我认为还是应该在 studio」 (on the catalog, source, layers, history and diagnostics);
「studio 是给开发人员用的， setup 时给管理员用的」.

Not taken: (a) *Setup keeps the catalog as the "environment view" and Studio keeps the pillars* — the catalog's tools are
a developer's, and two homes for one item is the defect; (b) *everything metadata-shaped into Studio including the
administration reached through metadata pages* — rejected by [D7](#d7): holders, assignments and membership are
administration and get Setup pages of their own.

### D2 — One mechanism: a customization of an installed package is an item of its paired `.custom` package, and overriding an existing item is a declaration in that item's body {#d2}

**Where a customization lives.** Every change a customer makes to an installed base — HotCRM — is an item of the
customer's paired writable package **`<base>.custom`** ([D3](#d3)): a new item, an override of an existing item, or an
extension of a base object ([D10](#d10)). Code and Studio use the one mechanism: what a developer writes into
`hotcrm.custom` in a repository and what an administrator does in Studio produce the same package, which is exported
(`GET /packages/:id/export`), committed, reviewed and deployed to another environment as any package is (ADR-0070 D4).
Maintainer, verbatim: 「方向定为包级覆盖：代码和 Studio 用同一机制，定制都进 .custom。」 A dependent package a vendor or partner
ships adds items under its own names; it never declares an override (the refusal paragraph below).

**How an existing item is overridden — by declaration, in the body.** An item of the base's paired `.custom` package
([D3](#d3)) that carries the base's name and declares in its own body

```ts
overrides: { package: '<base package id>', basedOn: '<the base package's manifest.version the override was taken from>' }
```

replaces the base's item **whole** for every read that serves the base's name ([D8](#d8)). The declaration lives in the
item document — not in a manifest list, not in a side table — so it travels with the item through export and git, and
the `.custom` manifest needs no index of what it overrides (Q2, 「全部同意」: declaration in the item body). `package`
names the base; `basedOn` records which version of the base **package** — its `manifest.version`, not a history version
of the item — the author started from (ruling record 6549129352 on #28404, aligned here). **`basedOn` is recorded,
not judged**: no door compares it with the installed base's version, no upgrade diff is produced, and nothing is
refused on it (epic #28236, *Not in this epic*: upgrade diff / `basedOn` checking, recorded only). Whole-document
replace is ADR-0005's binding principle 3 and ADR-0131 D6's O rule carried over unchanged: no field-level patch, no
three-way merge — the author who changes one column ships the whole view.

**Undeclared same-name is refused at publish — one rule for the whole dependency closure** (Q1; scope ruled 2026-10-31
on decision card [#28364](https://github.com/objectstack-ai/objectstack/issues/28364)). Inside a base's dependency closure, an item of **any** dependent package — the
paired `.custom` or an ordinary dependent such as a partner's extension — that bears a base item's name **without** the
declaration is refused when its package publishes, for every overridable type alike. For the paired `.custom` the
refusal names both fixes: declare the override, or rename the item; for any other dependent it names the one fix it has:
rename. It is never served as a silent replacement and never kept as "that package's own item" under the base's name.
**The declaration is admitted from the paired `.custom` alone** (ruled **A** on decision card #28390, 2026-10-31, ruling
record 6542177429; the rider of ruling record 6540351677 that opened it to any package in the closure is withdrawn): a
dependent that carries `overrides` is refused at publish, at `os validate` and at the install door — the three points
[D10](#d10) uses for `__c` — so the overrider of a base item is fixed by role, never by publish order: `.custom` is the
customer's layer, a dependent is a contribution layer, the customer always has the last word, and the layered read keeps
its two layers ([D8](#d8)). A partner that wants a different base view ships it under its own name and reaches it through
its own navigation contribution (ADR-0029 D7); a real partner need to replace a base item, when it appears, reopens
#28390 as its option B with that evidence. Outside the closure nothing
changes — two packages with no dependency relation keep ADR-0048 §3.3/§3.4's coexistence on a bare name, each under its
own package id; the exception this record writes into §3.4 is the closure case only ([Supersede
table](#supersede-table)). Maintainer, 2026-10-31, verbatim: 「没写这行声明、又恰好同名，是否建议统一规则，要么申明覆盖，要么禁止。这样会有什么坏处吗」, then
「同意」 to the uniform rule; its cost, on record there, is renaming a generic name — a dependent's own `home` page — and
under ruling A renaming is also a dependent's only route to a different version of a base item. This is the rule Context
§5 was missing and the rule N-09 implements: a name
is overridden because the author said so, and the read can tell ([D8](#d8)). **N-09's precondition** (decision card
#28364): before the gate lands, the examples and test deployments are counted for undeclared same-name rows inside a
closure — zero, and the gate lands as is; otherwise the list goes to the maintainer before a migration is chosen.

**Only items inside the dependency closure can be overridden.** `.custom` declares its dependency on the base
([D3](#d3)); the write door judges an override against the transitive closure of `manifest.dependencies` the save door
already computes (`packages/metadata-protocol/src/protocol-write-package-scope.ts#resolveWritePackageScope`, ADR-0141 D1). An override of
an item outside the closure is refused with "declare a dependency" as the fix, the sentence that door already prints.

**Which types.** The declared override applies to the item types a package ships as standalone documents and Studio
or the metadata API can author: at least the five former overlay types (`view`, `dashboard`, `report`, `translation`,
`email_template`), `flow` (under [D9](#d9)'s conditions), `action` (direction only — its ledger switch landed 2026-10-30; under [D9](#d9)'s
conditions 1–3; no door in this epic), `page`, `app`, `dataset`, `doc`, `book` and `mapping`; the spec card (N-08) closes the list against the registry
(`packages/spec/src/kernel/metadata-plugin.zod.ts#allowRuntimeCreate`), and the closed list is a constant the write gate
reads, never a judgement the gate makes. Three types are excluded whatever the registry says — the ones the security
catalog holds one name per deployment for: **permission sets, positions and capabilities are not overridable**
([D6](#d6); ADR-0048's 2026-10-08 addendum, ADR-0131 D3). `object` is **extended**, never replaced ([D10](#d10));
`field` rides with its object. The types ADR-0126 §3 assigns outside the regimes as code (`hook`, `job`, `api`,
`agent`, …) stay outside: customization of those is a new version of the package.

**What this lifts from ADR-0126 §9 and ADR-0131 D6.** §9's first bullet deferred it: "The ServiceNow-style overlay layer
(badge / customization list / diff-vs-base / revert / upgrade skip-report) — recorded as the mature direction **if**
customer pull for in-place customization appears; deferred again here." The pull is on record (HotCRM's pass, the 2026-10-30 walkthrough), and this record charters
**three of the five** on facts the platform serves: the **badge** (an item of `.custom` is marked "customization"; an
override is marked "overrides `<base>`" from its declaration), the **customization list** (the per-package read of
[D8](#d8), and the landing's counts) and **revert** ("Restore package original" = delete the overriding item from
`.custom`, so the base's document is served again). **Diff-vs-base and the upgrade skip-report stay deferred**, and §9's
second bullet — no clone provenance — stands ([D4](#d4)). ADR-0131 D6's sentence that the customer's change is
"environment-level state beside" the managed item is superseded: the change is an item of a package beside it. Its
other sentences stand — no door edits a managed definition, environment scope, no per-organization axis.

Not taken: **in-place overlay editing of a read-only package's item in Studio** (the 2026-10-30 draft's D2, writing the
package-less overlay row) — superseded by this decision before any card implemented it (epic #28236: #28147 closed,
replaced by N-17); a **virtual package** standing for "this environment's customization layer" — the `.custom` package
is real, exported and versioned, which is what the maintainer asked of it under [D3](#d3).

### D3 — Every installed base gets a paired `<base>.custom` package: auto-created, dependency declared, namespace explicit, and the base cannot be uninstalled while it exists {#d3}

**Underneath, a real package.** ADR-0070 D1 holds: an item the customer adds "to HotCRM" lives in a writable package.
That package is **`hotcrm.custom`** — an ordinary writable package, one per base, never one per environment, that
declares its dependency on the base in `manifest.dependencies` (ADR-0141 D1/D5: checked before install, co-owning the
namespace it shares by declaration). Maintainer, verbatim, on the suffix: 「同意 后缀改成 .custom」. The pairing idea
is the maintainer's from the 2026-10-30 thread: 「假设未来客户安装了很多软件包，对具体软件包的定制岂不是在 软件包中直接看更方便，如果在setup，都混在一起了。」; 「流必须住在可写包里（ADR-0070），能否虚拟一个 hotcrm.customize 包，但是设计者看的时候应该在一个及诶慢。」 (verbatim; the last word is a typing slip for 界面, "one interface" — editorial note, not part of
the quote; the suffix was later ruled `.custom`).

- **Auto-created, without a prompt, on the customer's first customization of the base** — from Studio, from the clone
  door ([D4](#d4)), from the migration ([D11](#d11)). Epic #28236 records this as ruling D-3 without a quoted sentence;
  this record is its record. One **ensure door** creates it idempotently ("create if absent"; N-13) and is the only
  creation path: no second door builds the pair. This amends ADR-0070 D3 for the paired case: D3 forbade the *silent
  catch-all* and left a prompted auto-provision open (ADR-0070 open question 1); a deterministic, per-base,
  dependency-declaring target whose item header and folded switcher say where the item went is neither a catch-all nor
  silent, so the prompt is dropped here and stays everywhere else D3 names.
- **Namespace explicit: `<base namespace>_custom`, never derived** (Q4). For HotCRM (`namespace: 'crm'`) the pair's
  namespace is `crm_custom`; the ensure door sets it, and `deriveNamespaceFromPackageId`'s answer for `hotcrm.custom` —
  `custom` — is never written. So a new object authored into the pair is `crm_custom_<short>`, and the namespace gate
  (ADR-0048 §3.2) admits it beside the base. Extension **field** names on base objects are a different rule
  ([D10](#d10): `__c`); the namespace rule reads object names, not field names.
- **Dependency range.** The ensure door writes the installed base's major — `^<major>` of the base's `manifest.version`
  at creation. Today that range is read where ADR-0141 D2 reads any dependency: when the pair itself is installed or
  re-installed (an export of `hotcrm.custom` deployed into another environment), judged against the base record found
  there. Nothing intercepts an upgrade of the base (ADR-0141 D3 defers that), so the range is also the declaration a
  future interception would read. `^<major>` admits the base's minor and patch versions at a re-install and refuses a
  different major, which is where `basedOn` is read by a human. *Decided here where the rulings were silent; merge
  question 1.*
- **Walled postures.** Under `group` / `isolated` the ensure door answers `403` for a tenant administrator (the walled
  postures' rule for an environment-level write — ADR-0126 §5, ADR-0131 D12); the operator creates and fills the pair. Under `single` the
  administrator holding `manage_metadata` does.
- **Uninstall of the base is refused while its `.custom` exists**, naming the pair — the epic's two-minute check,
  verbatim: 「卸载 HotCRM 被拒并点名 `hotcrm.custom`」. The administrator exports or deletes `hotcrm.custom` first; the
  refusal is a resource-state conflict in the family `uninstallPackage` already answers for an extended object (`409`,
  the `PackageUninstallExtendedError` shape), from the same door, so a refused uninstall leaves no half-removed base.
  This supersedes ADR-0141 D3's uninstall item for the paired case only; the general item — a dependent that is not
  the base's own `.custom` — stays deferred with its trigger (N-14).
- **It receives**: overrides and new items authored from the base's Studio surface ([D2](#d2)), "new similar" copies
  of the base's flows ([D4](#d4)), extensions of the base's objects ([D10](#d10)), the migrated package-less rows
  ([D11](#d11)), and environment-level permission sets **for** the base (new sets, never an override of the base's —
  [D6](#d6)). Upgrading the base never touches it (ADR-0126 D4 wall 3: upgrades rewrite the base, never the customer's
  choices — here the customer's package).

**On top, one surface.** Studio opens HotCRM and the designer sees **one** HotCRM: the pillar rails list the base's
items (read-only, viewable with the [D1](#d1) tools) and the pair's items (writable) **in the same list**, the latter
marked "customization" and an override marked with the base it overrides, filterable with "only customizations"; New,
"new similar" and "Customize" land in the pair without asking; the pending-changes and publish surfaces act on the pair;
the package switcher folds `hotcrm.custom` under HotCRM instead of giving it a row. Items another package contributes
to the base (flows watching its objects, fields extending its objects, ADR-0029 D7 navigation contributions) are listed
**greyed, with their source package named** — a presentation this record decides (ADR-0029 D7 defines the
contribution, not how a contributed item is drawn). **Studio's customization surface waits for the override core** —
maintainer, verbatim: 「我建议先等包级覆盖开发完，再考虑这个界面的修改」 — so this paragraph is P2 of the
[Rollout](#rollout), after P1.

**Upgrade and audit.** "What did we change on HotCRM" is one place: `hotcrm.custom` plus the base's switched-off items
([D4](#d4)). Studio's landing carries one line per package ("n customized, m switched off", read from [D8](#d8)'s
per-package read and the ledger); Setup carries nothing per package.

### D4 — The operational switch is offered on the item in Studio; clone survives only as "new similar"; Setup › Packaged automation retires {#d4}

ADR-0126 §7.4 chose Setup as the first surface for the packaged-flow toggle and clone; that was a surface choice (its
Fork D), not one of the §9 walls. This record moves the switch to where the item is and re-homes the clone:

- **The ledger switch, on the item** (#28148, N-04). In Studio, on a **read-only package's flow**, the Enabled switch
  binds the **activation ledger** (`GET /api/v1/automation/_status`, `POST /api/v1/automation/<name>/toggle`) and reads
  "off for this deployment", with its three readings from
  `ui/packages/app-shell/src/views/setup/packagedFlows.ts#activationReading`; on a **writable package's flow** it stays
  the definition switch ("disabled; publish to apply"). Two switches, two words — never one control that means
  different things by package. Maintainer, verbatim: 「#28148 只继续本部署开关，克隆部分停」.
- **Authority is the ledger door's, not Studio's.** The toggle's gate
  (`packages/runtime/src/domains/activation-gate.ts#refuseUngrantedActivationWrite`) admits `manage_metadata` in the
  `single` posture and, under the walled `group` / `isolated` postures, only the PLATFORM_ADMIN posture rung (ADR-0126
  §5); a tenant administrator there is refused with a sentence naming the platform operator. Studio pre-judges that
  verdict from the two served facts the console already reads (`features.tenancyPosture` through
  `ui/packages/app-shell/src/hooks/useTenancyPosture.ts#useTenancyPosture`, and `user.isPlatformAdmin` on the session
  — the posture-and-rung half of `ui/packages/app-shell/src/views/metadata-admin/catalog-scope.ts#walledCatalogReadOnly`,
  without its catalog-type filter, because the ledger gate has no type input, and ⛔ not that function itself, which
  answers `false` for a flow): the switch draws **disabled, in the console's own words**, for a principal those facts
  refuse, and the server's refusal is shown verbatim after any attempt — never a live control that always answers 403,
  and never a client copy of the gate's sentence.
- **Clone is kept only as "new similar"** (Q6; #28149, N-21; Studio N-22). The door takes a target package: given, it
  must be an installed **writable** package inside whose dependency closure the flow's objects lie; omitted, the target
  is the source's `<base>.custom`, ensured through [D3](#d3)'s door. ⛔ No package-less clone after that card: the
  omission no longer writes a package-less row. The copy is written **inactive**, so a "new similar" never double-runs
  beside its original (Context §4), and the response says so. A new machine name stays mandatory (ADR-0126 §7.1); the
  copy carries no base envelope and no lineage (§9's second bullet stands: no `cloned_from`, no diff against the base,
  no "based on vN" notice — on either surface). What the clone used to be *for* — changing what HotCRM's flow does —
  is [D9](#d9)'s declared override, not a copy.
- **Setup › Packaged automation retires** after two things have landed: the ledger switch on the item (this decision's
  first bullet) and the landing counts ([D3](#d3), N-24) — Q8, 「全部同意」. Until then it stays the deployment-wide
  operations overview; its retirement is N-28, with the Setup → Metadata redirects. The 2026-10-30 draft left this
  open; it is decided.
- **The action ledger switch is out of this epic** (#27842, #27504; 「四个小问题 同意」): `action` keeps ADR-0126 §8's
  disable leg where it is.

Maintainer, verbatim (2026-10-30): 「打包自动化开关，这个就很奇怪，正常的操作我应该是在studio中进入 hotcrm app，选中一个流程，点禁用或者复制更符合逻辑吧？」

### D5 — The app → Studio bridge draws for a read-only package, as a browse entry {#d5}

objectui#12615's reasoning ("a pencil promised an edit Studio cannot deliver") rules out the **pencil**, not the
**entry**. For a read-only package the app switcher row and the app bar entry draw as "Open {app} in Studio" (an eye,
not a pencil; zh 「在 Studio 中查看 {app}」), for the same principals through the same gate
(`ui/packages/app-shell/src/hooks/useStudioDesignGate.ts` answers a posture, ⛔ still never a second derivation of
`writable`); a writable package keeps "Edit {app} in Studio". Kernel packages and an unread or failed package list
still draw nothing. (#27356 row 12, letter B; landed as PR #28076, 2026-10-30.)

Maintainer, verbatim: 「「Edit {app} in Studio」代码包/已安装包一律不画，合理吗？ai写完代码，人类需要进去确认啊」.

### D6 — Not done, recorded so silence cannot be read as consent {#d6}

- **No per-organization override.** ADR-0131 D6's environment scope stands: `.custom` is the environment's package;
  under a wall the operator customizes for every tenant and a tenant administrator is refused (D3's ensure door, every
  write door). The organization axis ADR-0131 D1 removed does not return under another name.
- **Permission sets, positions and capabilities are not overridable.** They hold one name per deployment (ADR-0048's
  2026-10-08 addendum; ADR-0131 D3/D4 reference them by bare name with no package context), so a same-name item in
  `.custom` is the ambiguity that addendum refuses, not a disambiguable override. A customer's own set is a **new** set
  in `.custom` ("new similar", N-20); the base's sets are read-only and switchable through the ledger as today.
- **No structural change to a base field.** Type, requiredness, uniqueness, reference target, default, formula and
  anything DDL or a stored value depends on stay the vendor's ([D10](#d10)); the customer hides through views and
  permissions, as ADR-0131 D6's table has it.
- **No code-only type** (`hook`, `job`, `api`, `agent`, `field` on its own, …) gains an override channel.
- **No clone lineage, no upgrade diff, no `basedOn` judgement** ([D2](#d2), [D4](#d4)).
- **No fields table in the object designer** (#27356 row 14, letter **C**, maintainer 2026-10-30T10:07Z). The Records
  grid's columns and the Form canvas each enumerate every field and open the one field inspector; objectui#5813 and
  objectui#12450 stand. Maintainer, verbatim: 「Studio 的对象设计器，第一栏数据不就是每一个字段吗？表单对应的不也是每一个字段吗」.
- **No Setup designer for any type**, transitional redirects excepted ([D1](#d1)).
- **No package-less authoring destination survives** [D11](#d11): ADR-0070 D5/D6, completed.

### D7 — Setup pages the move owes {#d7}

Administration reached through Setup's metadata pages today gets a page of its own under Setup before those routes
retire: **position holders** (`ui/packages/app-shell/src/views/metadata-admin/PositionHoldersSection.tsx`) and
**permission-set assignment** (`ui/packages/app-shell/src/views/metadata-admin/AssignedUsersSection.tsx`) are the two
live sections the move re-homes (#28241, N-27); **queue membership** has no section at this head; its Setup page is a
child of ADR-0142's landing (a row for its console step at that record's acceptance), not of this record's epic —
never inside a metadata page either way. Each is a people-and-organization page (the scope of `setup.access` and the
delegated-administrator gate), not a metadata page. ⛔ The redirects do not retire a Setup → Metadata route whose
administrative action has no Setup home yet.

### D8 — One effective read: package-less, base-named, layered, list and export reads agree, and the code package that ships a name is always a candidate {#d8}

Five reads serve an installed item's content, and today they can disagree (Context §5). Under this record they answer
from **one** resolution:

1. **The address of a name a code package ships is that package.** A package-less read (`GET /api/v1/meta/:type/:name`
   with no `?package`, the base app's rendering) of a name the loader registered for package X resolves to **X** — the
   code package is a candidate of `packagelessAddress`, and a stored row bound to another package never wins by being
   the only stored row (#28238, N-03). A stored row with **no** package — the row Setup writes today — keeps winning
   over the code package until [D11](#d11) migrates it; ⛔ that card does not break an existing customization.
2. **Within X's address, a declared override is served over the base's document.** The read that serves X's name — the
   package-less read, the read naming X (`?package=X`), the layered read (`packages/metadata-protocol/src/protocol.ts#getMetaItemLayered`: `code` = the base's
   document, `override` = the `.custom` item, `effective` = the served one), the list (`GET /api/v1/meta/:type`, scoped
   to X or not) and the export of X's app surface — serves the **one** document the declaration selects, the `.custom` item that declares it. An item of the pair that
   bears X's name **without** the declaration, and an item of any other dependent that bears X's name — declared or not —
   have no place under this record: each is refused when its package publishes ([D2](#d2)); until N-09 lands, item 1 keeps
   the code package the owner of X's address, so such a row is not served as X's (N-03). A same-named item of a package
   **outside** X's closure is not a candidate for X's address at all; it is that package's own item, served under its
   own address (ADR-0048 §3.3's qualified reference).
3. **Export carries the declaration.** `GET /packages/hotcrm.custom/export` carries the overriding item with its
   `overrides` block; `GET /packages/hotcrm/export` carries the base unchanged. The epic's two-minute check, verbatim:
   「HotCRM 视图「定制」→ 三处读取同一列集、导出带声明、「恢复包原版」回原样」.
4. **A per-package customization read** (N-15) answers, for a base, its overrides, its extensions and its switched-off
   items — served rows and ledger rows, nothing computed — and the landing's counts and Studio's "only customizations"
   filter read it.

The pin that holds this is one test across the five reads for one item (#28238's acceptance names the first three and
the app's list); `packages/metadata-protocol/src/protocol.item-read-overlay-cache.test.ts` and
`packages/objectql/src/environment-overlay-five-types.test.ts` keep their meaning for the unmigrated row.

This supersedes ADR-0048 §3.3's "best-effort" sentence for every read that carries a type and a name: the context-free
read has an owner — the shipping package or its declared override — and "first match" is no longer an answer.

### D9 — Flows: an override is served over the code package's name, rebound in one reload, inherits the ledger identity, and waits for real version pinning {#d9}

A flow is behavioural (ADR-0126 §2): two live versions double-fire, and a replacement under a suspended run breaks it.
The declared override of [D2](#d2) applies to `flow` under four conditions, all of them this record's:

1. **Served over the code package.** `resolveFlowPrecedence` arms the item that declares `overrides` on the base's
   name — from `.custom` ([D2](#d2)) — **over** the loader's body for that name. An *undeclared* row of a held name
   inside the closure, and a dependent's row declared or not, is refused at publish ([D2](#d2)); the rank keeps shadowing — and
   warning on — every undeclared runtime row that still reaches it (a package-less row until [D11](#d11) migrates it, a
   row of a package outside the closure, and a dependent's until N-09 lands), exactly as today. The rank gains one
   case, "declared override", and the remedy it prints for the undeclared case names the declaration or a new name
   instead of the clone.
2. **Rebound in one reload.** The trigger of a held name is unbound from the base's definition and bound to the
   override's in one reload step of the engine (`kernel:ready` / `metadata:reloaded` sync); there is no window in which
   both definitions are bound or neither is, so a record change fires exactly one of them. Dropping the override (the
   "Restore package original" of [D2](#d2)) rebinds the base the same way.
3. **Ledger identity inherited.** `sys_metadata_activation` keys a flow by `(metadata_type, name)`
   (`packages/platform-objects/src/system/sys-metadata-activation.object.ts`), and the override keeps the base's name,
   so one ledger row switches **whichever** definition is armed for that name; `packages/services/service-automation/src/engine.ts#packagedFlowOwner` keeps
   answering the base's package for the name, so the toggle door and the §7.3 subflow guard still see a packaged flow. No second
   switch, no second row.
4. **Real version pinning first** (Q3; 「四个小问题 同意」: flow customization waits for real version pinning, with no
   interim publish gate). A suspended run resumes on the **version it started on**: `resolveResumeTarget` reads the
   run's pinned version (`flowVersion`, resolved through `sys_metadata_history` — ADR-0009 §2.2's `getByHash`, or the
   version the engine recorded for that name) instead of `flows.get(name)`, and finishes there; new runs start on the
   armed definition. That is what ADR-0009 §2.1 promised for `flow` and the resume never delivered (Context §7); it
   lands as N-12 before N-11 (the override) and N-18 (Studio) are cut, and no interim gate refuses an override meanwhile
   — there is simply no override door until the pin exists. The epic's two-minute check, verbatim: 「流程定制只跑新定义、挂起运行按旧版完成」.

What does not change: the subflow cascade (ADR-0126 §7.3 — disabling a flow another packaged flow calls is refused
naming the callers), the `FLOW_DISABLED` consult at `execute()`, and the walled operator gate on the ledger write
(ADR-0126 §5).

**`action`, the other Regime C type, takes the same shape later** (ruled 2026-10-31 on decision card #28364, in Q3's
pattern). Its precondition has landed: the action ledger switch is on `main` (#27842 and #27504, both closed 2026-10-30 —
outside this epic, [D4](#d4)). A declared override of a base's `action` is admitted, once its door is cut, under conditions 1–3
above read for an action: served over the code package's name, rebound in one reload, one ledger row for the name;
condition 4 does not apply — an action has no suspended run. The door itself is not cut here: there is no override door
for `action` yet, no interim gate, and no card of this epic opens one. An undeclared same-name `action` in a dependent is
refused at publish like any other overridable kind ([D2](#d2)); until the action override opens, the only fix is rename.
A customer's own button is a new action in `.custom` ([D4](#d4), "new similar"). ADR-0126 §3 places `action` in Regime C
on the maintainer's 「动作 可能是需要开关的，因为有的 action 我不想启用。」, which is why the switch came first.

### D10 — Object extension: `__c` fields are reserved to `.custom`, and a base field changes only within a display-property whitelist {#d10}

Objects are **extended**, never replaced ([D2](#d2)). The extension is the `objectExtensions` entry
(`packages/spec/src/data/object.zod.ts#ObjectExtensionSchema`, merged by
`packages/objectql/src/registry.ts#mergeObjectDefinitions`), authored into `.custom` — Regime E of ADR-0126, with two
rules added:

- **Extension fields end in `__c`, and only a `.custom` package may declare one.** Maintainer, verbatim: 「扩展字段用 __c 后缀，只有 .custom 包能用。」 So a customer's field on `crm_account` is `region__c`; a vendor's next version can
  never take that name — the suffix is refused in a non-`.custom` package at publish, at `os validate` and at the install
  door (`packages/metadata-protocol/src/protocol-package-install.ts#installPackage`), so a vendor artifact that ships
  one is refused on entry — and a customer's extension can never be mistaken for the vendor's. A field a vendor package adds to another vendor's object
  (ADR-0029 D7 extension, the HotCRM module case of ADR-0141 D7) keeps the plain spelling; the suffix names the
  customer's layer, and nothing else. The epic's two-minute check, verbatim: 「对象加字段落 `.custom`、名为 `xxx__c`」.
- **A base field is changed only within a display-property whitelist** (Q7). The extension may **patch** a base field's
  display properties — the properties whose change alters no DDL, no stored value, no validation verdict and no
  permission: label, description, help text, placeholder and the labels of picklist options are the class; the exact
  member list is a closed `packages/spec` constant the spec card measures against `FieldSchema` (N-08, N-23a) — the
  whitelist the write gate reads, never a judgement the gate makes — and a property is admitted into it by that test,
  never by convenience. Everything else on a base field — type, `required`, `unique`,
  `reference`, `defaultValue`, formulas, `options` membership — is refused on the extension with a prescription naming
  the whitelist ([D6](#d6)). The patch is a per-field map in the extension body; `mergeObjectDefinitions` applies it
  after the additive merges, and the ADR-0029 D9.2a scalar yield applies to it as to the three scalars.

Studio's "add field" on a base object ([D3](#d3)'s one surface) writes exactly this: an extension in `.custom`, the
name suffixed, the base untouched (N-23c).

### D11 — Migration, then closure: package-less overlay rows become declared overrides, the package-less write closes, and the stopgaps retire {#d11}

- **Migrate** (N-16, Q5). Every `sys_metadata` row with `package_id` NULL that overlays an item a code package ships
  becomes a declared override of that item in the base's `<base>.custom` (created by [D3](#d3)'s ensure door as needed),
  `basedOn` set to the installed base package's `manifest.version` at migration. A package-less row for an item **no** package ships is
  environment metadata, not an overlay, and is not touched. The migration is idempotent and reports per base what it
  moved; it runs as a CLI ceremony the administrator invokes, in the shape ADR-0131 D10 set.
- **Close** (N-16). After the migration, a package-less write onto a packaged item (`PUT /api/v1/meta/:type/:name` with
  no `?package`, the "Customize with an overlay" path Setup offers) is refused with a prescription naming the pair:
  `packagelessAddress` stops answering an unbound binding for a packaged name, and the five-type
  `allowEnvironmentOverlay` tier stops opening a write door — it survives as the predicate the migration reads and the
  read path honours for a row not yet migrated. The three Setup/Studio writes that produce such rows today — rollback
  onto a read-only package's item, source save, reset/delete of the overlay — are offered only on the writable package
  ([D1](#d1)).
- **Retire**: the package-less clone ([D4](#d4)), the Setup designer routes for the seven pillar types ([D1](#d1), by
  redirect), Setup › Packaged automation ([D4](#d4), N-28), and the "Read-only · Customize with an overlay" link
  (#27927) that sends Studio to Setup.

This completes ADR-0070 D5 ("Retire the stopgaps via a migration affordance") for the overlay rows, which that record
left to "A small migration (or admin action)".

## Supersede table {#supersede-table}

Each clause this record supersedes or amends, quoted as recorded, then the rule now, then the gate and the pin that change —
every symbol as a `path#symbol` anchor the symbol gate resolves on `origin/main` `69ce01d7`. Prime Directive #13: the
recorded sentences stay in their records; their Status lines carry the dated pointer; nothing below is edited there.

| Record · clause | Recorded (verbatim) | Rule now | Gate and pin that change |
|:---|:---|:---|:---|
| **ADR-0126 D1** (§2, Regime C for behavioural types; §3 assigns `flow`) | "→ **Disable + clone** (Regime C — amendment ruling 2, the landed #11513 shape generalized). Three independent parts, no ceremony connecting them: the packaged base is **locked** — in-place edit refused loudly at the write door, the refusal naming the sanctioned path; each packaged behavioral artifact carries an **enable/disable switch** — a ledger row flip (§4), operator-gated per §5; customization is **authoring an ordinary sibling artifact** (clone or from scratch; new machine name mandatory, whole-definition copy — §7.1). There is no designated-replacement linkage. ⛔ Never silent override, never an overlay read path." | The base stays locked and the switch stays ([D4](#d4)); customization of a behavioural item is a **declared override** in `.custom`, served over the base's name under [D9](#d9)'s four conditions. "Never silent" stands — the override is declared and refused when undeclared ([D2](#d2)); "never an overlay read path" is superseded for the declared case. | `packages/metadata-protocol/src/protocol-packaged-base-refusal.ts#refusePackagedBaseOverride` admits a declared override from the base's paired `.custom` and keeps refusing every other write onto a sealed item; `packages/services/service-automation/src/flow-precedence.ts#resolveFlowPrecedence` gains the declared rank. Pins: `packages/metadata-protocol/src/protocol.packaged-base-refusal.test.ts`, `packages/services/service-automation/src/flow-name-shadowing.test.ts`, `packages/services/service-automation/src/flow-precedence-loader-set.test.ts`. Cards N-09, N-11. |
| **ADR-0126 D4 wall 1** (§6 item 1) | "**The #6190 phantom-overlay wall.** Any design that needs `allowOrgOverride` flipped on a behavioral type has drifted back into #6190 — that is a stop-and-report, not a pin to update. The identity pin (`protocol.org-scoped-write-refused.test.ts`, exactly five overlay types) turning red on such a flip is the pin working. This wall's corollary stands too: name-redirection — resolving a packaged artifact's name to some other artifact at dispatch — is an overlay **read** path under another name, rejected on the record (2026-08-25 discussion); with no designation linkage in the model (§4) there is also nothing to redirect to." | No registry flag is flipped and no organization axis returns: the opt-in is the item's own declaration, judged against the closure ([D2](#d2)). The corollary is superseded for the **declared** case only: a declared override is served at the base's name ([D8](#d8), [D9](#d9)); an undeclared redirection stays refused. | `packages/metadata-protocol/src/protocol.org-scoped-write-refused.test.ts` **stays green and unchanged** — it pins that no organization-scoped write is accepted, which this record keeps; the five-type exemption it once guarded is retired by [D11](#d11), not re-opened. The declared rank lands in `packages/services/service-automation/src/flow-precedence.ts#resolveFlowPrecedence`. Card N-11. |
| **ADR-0126 §7.1** (Clone, first bullet) | "⛔ No same-name clone in a second package: storage legitimately holds both — the uniqueness index keys on `(type, name, organization_id, COALESCE(package_id, ''), COALESCE(bundle_member, ''))` (ADR-0005, amended 2026-08-09 by #6825 and 2026-10-12 by #22877 ruling A; ADR-0048 governs the cross-package coexistence) — and the engine's name-keyed flow map makes the winner insertion-order: measured as a silent, non-deterministic replacement (#11665 §2.2; #11997 tracks the shadow diagnostics independently of this model)." | A same-name item in a second package is admitted in exactly one shape: the **declared** override from the base's paired `.custom`, the one package admitted to declare ([D2](#d2)) — served by its declaration and never by insertion order ([D8](#d8), [D9](#d9)). "New similar" keeps the mandatory new machine name ([D4](#d4)); the prohibition stands for every undeclared shape. | `packages/services/service-automation/src/flow-precedence.ts#resolveFlowPrecedence` arms by declaration, not arrival; `packages/runtime/src/flow-clone.ts#cloneFlowDefinition` keeps the new name mandatory. Pins: `packages/services/service-automation/src/flow-name-shadowing.test.ts`, `packages/services/service-automation/src/flow-sync-one-precedence.test.ts`. Cards N-09, N-11, N-21. |
| **ADR-0131 D6** (Managed; regimes re-homed at environment scope) | "**No door edits a managed definition** — not Setup, not Studio, not the data or metadata API; to change one, the vendor publishes a version and upgrades reach it untouched. What the customer changes lives **beside** the managed item, as environment-level state that upgrades never touch — the three regimes of [ADR-0126](./0126-packaged-metadata-customization-model.md), kept and re-homed at environment scope:" · O: "an environment row of the **same name** replaces the managed item **whole** — ADR-0005's environment layer, exactly as today, with the per-organization axis retired." · C: "**clone** is a whole-definition sibling under a **new name** with no linkage to the base (ADR-0126 §7.1, amendment ruling 2)." | The managed definition is still never edited. What the customer changes is an **item of `<base>.custom`** — a package, exported and deployed — not an environment row: O becomes the declared override (same whole replace), C's clone becomes "new similar" into `.custom` and the behavioural override of [D9](#d9), E's extension lives in `.custom` under [D10](#d10)'s rules. Environment scope stands; no per-organization axis. | `packages/metadata-protocol/src/protocol-environment-rows.ts#packagelessAddress` stops addressing a packaged name to an unbound row once [D11](#d11) has run; `packages/metadata-protocol/src/protocol.ts#servedOverlayRowCandidates` serves the declared override within the base's address. Pins: `packages/metadata-protocol/src/protocol.packageless-save-address.test.ts`, `packages/metadata-protocol/src/protocol.item-active-rows-one-read.test.ts`, `packages/metadata-protocol/src/protocol.item-read-overlay-cache.test.ts`. Cards N-10, N-16. |
| **ADR-0005 five-type tier** (binding principle 5; the 2026-05-22 amendment's whitelist; addendum (d)'s registry opt-in, spelled `allowEnvironmentOverlay` since protocol 18) | "**Whitelist by type.** Only types explicitly enabled for overlay can be saved through `PUT /api/v1/meta/*`. Phase 1 ships with `view` and `dashboard` enabled; other types return `400 customization_not_allowed`." · "only the metadata types whose runtime semantics are **render-time** can be overridden per organization. Anything that influences the **physical schema, persisted contract, or automation guarantees** must be platform-global." · "The **opt-in for runtime org customization** lives in exactly one place: the `allowOrgOverride` boolean on its `DEFAULT_METADATA_TYPE_REGISTRY` entry." | What a customer may override is decided by **declaration and closure** ([D2](#d2)), for every runtime-creatable item type except the three of [D6](#d6); the per-type tier no longer opens a write door. The registry flag survives as the migration's predicate and the read of an unmigrated row ([D11](#d11)). ADR-0005's whole-document rule, its `id`-stripping rule and its storage shape are untouched. | `packages/spec/src/kernel/metadata-plugin.zod.ts#allowEnvironmentOverlay` stops gating the write; the type half of the sealed-item predicate in `packages/metadata-protocol/src/protocol.ts` reads the declaration instead. Pins: `packages/objectql/src/environment-overlay-five-types.test.ts` (re-judged for the migrated state), `packages/metadata-protocol/src/protocol.packaged-base-refusal.test.ts`. Cards N-08, N-09, N-16. |
| **ADR-0048 §3.3** (prefer-local, qualify-to-cross) | "A *context-free* read (`getItem` with no package id) is best-effort: it returns the first match and the caller is expected to pass the package id when it cares." | A context-free read of a name a code package ships has an **owner**: that package, or its declared override in `.custom`; a same-named item of a package outside the closure is served only under its own address ([D8](#d8)); inside the closure it is a declared override or refused at publish (the §3.4 row). "First match" is no longer an answer for a read carrying a type and a name. | `packages/metadata-protocol/src/protocol-environment-rows.ts#packagelessAddress` (the code package becomes a candidate); `packages/metadata-protocol/src/protocol.ts#packagelessReadAddress`. Pin: the five-read agreement test of #28238 (new) beside `packages/metadata-protocol/src/protocol.item-read-overlay-cache.test.ts`. Cards N-03, N-10. |
| **ADR-0048 §3.4** (per-item cross-package detection retires) | "The cross-package **throw is retired**; two distinct packages coexist on the same bare name by construction." | Stands for packages with **no dependency relation**. Inside a base's dependency closure it is superseded: the paired `.custom`'s item bearing a base item's name is admitted only as a **declared** override and is otherwise refused at publish — declare or rename; any other dependent's item bearing a base item's name is refused at publish, declared or not — rename ([D2](#d2); ruled 2026-10-31 on #28364 and #28390). The same-package overwrite sentence and the 2026-10-08 narrowing stand. | The N-09 write gate reads the closure (`packages/metadata-protocol/src/protocol-write-package-scope.ts#resolveWritePackageScope`) and refuses the undeclared same-name item at publish; `packages/metadata-protocol/src/protocol-packaged-base-refusal.ts#refusePackagedBaseOverride` admits the declared one from the paired `.custom` alone. Pins: `packages/metadata-protocol/src/protocol.packaged-base-refusal.test.ts` (new case); the five-read agreement test of #28238. Cards N-09, N-10. |
| **ADR-0009 `executionPinned`** (§2, §2.1 `flow`, §2.4) — the resume reading; **amended, not superseded** | "A type with `executionPinned: true` gives a **stronger guarantee** than `supportsVersioning: true`" · `flow`: "Step executions can pause across redeploys" · "The row stores **only** the triple — never an inlined snapshot. The snapshot is recovered on demand via `repo.getByHash(ref, hash)`." | Nothing in ADR-0009 is reversed; its guarantee is **delivered** for `flow`: a suspended run resumes on the version it started on, and the version a flow's name serves may be a declared override's ([D9](#d9)). What changes is the engine's reading of the flag — resume by name, i.e. HEAD — which the record never sanctioned and the code did; ADR-0009's Status line says "Amended by", because no sentence of it is reversed. | `packages/services/service-automation/src/run-resume.ts#resolveResumeTarget` resolves the pinned version instead of `flows.get(name)`, through `packages/metadata-protocol/src/sys-metadata-repository.ts#getByHash` or the engine's recorded version. Pin: `packages/services/service-automation/src/unresumable-suspension-cause.test.ts` (re-judged: a renamed node on HEAD is no longer `RUN_NOT_FOUND` for a run pinned to the old version). Card N-12. |
| **ADR-0141 D3** (deferred, by name) — the uninstall row | "**Uninstall protection** — refusing to uninstall a package another installed package depends on" · "The uninstall proceeds; the dependent's lookups dangle. Only ADR-0029's extender refusal stands" · "A first customer uninstall that strands a dependent" | For the **paired case** the item is decided: uninstalling a base is refused while its `<base>.custom` exists, naming it ([D3](#d3)). The general item — a dependent that is not the base's own `.custom` — stays deferred with its trigger. | `packages/objectql/src/registry.ts#uninstallPackage` gains the pair check beside the ADR-0029 extender refusal (`packages/objectql/src/registry.ts#PackageUninstallExtendedError` is the shape). Pin: `packages/objectql/src/registry-assert-package-uninstallable.test.ts`. Card N-14. |
| **ADR-0070 D3** (select-or-create a base first) and **D5** (retire the stopgaps via a migration affordance) — the paired case | D3: "Every authoring surface follows the same contract; none silently defaults into a catch-all:" · D5: "Existing `package_id = null` rows are not broken." · "A small migration (or admin action) can bulk-assign legacy orphans to a default base named for the environment." | For a customer's first customization of an installed base, the base is `<base>.custom`, created by the ensure door without a prompt ([D3](#d3)) — a deterministic, declared, per-base target, not a catch-all; everywhere else D3's prompt stands. A package-less overlay row of a packaged item migrates into that pair as a declared override, not into "a default base named for the environment", and the package-less write then closes ([D11](#d11)); a package-less row no package ships keeps D5's treatment. | `packages/metadata-protocol/src/protocol-write-package-scope.ts#resolveWritePackageScope` (the target package the ensure door hands the write); `packages/metadata-protocol/src/protocol-environment-rows.ts#packagelessAddress` (closes after the migration). Pin: `packages/metadata-protocol/src/protocol.packageless-save-address.test.ts`. Cards N-13, N-16. |
| **ADR-0029 D7** (shell + slots; contributions) — amended, not superseded | the D7 heading, verbatim: *Shared admin surfaces are "shell + slots"; capability plugins contribute navigation* | The contribution model is unchanged. What D7 did not fix is fixed here: an item another package contributes to a base (a navigation contribution, an extension field, a flow on the base's objects) is drawn **greyed, with its source package named**, when the base is open in Studio ([D3](#d3)). | No gate or pin exists today for the drawing; the Studio one-surface card adds the pin. Card N-19. |
| **ADR-0126 §7.4** (surface) and **§9** first bullet — moved and lifted in part, not reversed | §7.4: "**Leaning D2 — a Setup page for packaged automation** (final call rides this ADR's merge)" · §9: "The ServiceNow-style overlay layer (badge / customization list / diff-vs-base / revert / upgrade skip-report) — recorded as the mature direction **if** customer pull for in-place customization appears; deferred again here." | The switch moves to the item in Studio and the Setup page retires after the landing counts ([D4](#d4)); badge, customization list and revert are chartered on served facts, diff-vs-base and the skip-report stay deferred ([D2](#d2)). | `packages/runtime/src/domains/activation-gate.ts#refuseUngrantedActivationWrite` is unchanged (the authority stays the door's); the console binds it from Studio (`ui/packages/app-shell/src/views/setup/packagedFlows.ts#activationReading`). Cards N-04, N-15, N-24, N-28. |

Two anchors the epic's territory names are **not** superseded clauses and are listed so they are not read as one:
`packages/spec/src/kernel/namespace-prefix.ts#deriveNamespaceFromPackageId` keeps its rule — an explicitly declared
namespace always wins — and [D3](#d3) simply declares one for the pair (pin:
`packages/spec/src/kernel/namespace-prefix.test.ts`, `packages/metadata-protocol/src/protocol.duplicate-package-target-namespace.test.ts`;
card N-13); `packages/objectql/src/registry.ts#mergeObjectDefinitions` keeps its additive merge and gains the
display-property patch and the `__c` reservation ([D10](#d10); pins
`packages/objectql/src/registry-object-extension-nonenumerated-prop-discard.test.ts`,
`packages/objectql/src/registry-extension-system-columns.test.ts`; cards N-23a/b).

## The eight questions, as agreed {#q1-q8}

Maintainer, 2026-10-30, verbatim: 「等我拍板的 8 个问题，全部同意」. Epic #28236 lists the eight in this order; each
is fixed above where it bites.

| # | Question | Agreed answer | Where |
|:---|:---|:---|:---|
| Q1 | Undeclared same-name item of a base's item | Refused at publish — every dependent package in the base's closure, every overridable type; the paired `.custom` declares or renames, any other dependent renames (scope ruled 2026-10-31, #28364; the declarer ruled A on #28390) | [D2](#d2) |
| Q2 | Where the override is declared | In the item body (`overrides: { package, basedOn }`) | [D2](#d2) |
| Q3 | Flows under a changing definition | Real version pinning first; the override after it | [D9](#d9) |
| Q4 | The pair's namespace | Explicit `<base namespace>_custom`, never derived | [D3](#d3) |
| Q5 | Package-less overlay writes | Closed after the migration | [D11](#d11) |
| Q6 | Clone | Kept only as "new similar" into `.custom` | [D4](#d4) |
| Q7 | Changes to a base field | Limited to a display-property whitelist | [D10](#d10) |
| Q8 | Setup › Packaged automation | Retired after the ledger switch on the item and the landing counts | [D4](#d4) |

## Consequences

- **One mechanism for code and Studio.** A developer's `hotcrm.custom` in git and an administrator's Studio session
  produce the same package; customizations export, review, deploy and roll back as a package does. The 2026-10-30
  walkthrough's four findings (epic #28236 速读: Studio cannot edit a read-only package; Setup writes a row that does not
  travel; a clone double-runs; a dependent's same-name view silently replaces the base's) each close under one rule.
- **One editor per item** stands ([D1](#d1)); the HotCRM pass's "two designers, two save models" disappears, and every
  future type answers "where is it edited" and "where does a customization live" by rule.
- **The vendor's upgrade and the customer's changes never meet.** Upgrades rewrite the base; `.custom` is untouched;
  `basedOn` tells a human what the override was taken from. The cost is ADR-0005's and ADR-0131's already: an overridden
  item shadows the vendor's later change to that one item until the customer re-bases it, and the platform computes no
  diff to help ([D6](#d6)).
- **The clauses of eight records move** — six superseded in part (ADR-0126, 0131, 0005, 0048, 0141, 0070) and two
  amended (ADR-0009, 0029) — each with its gate and pin named ([Supersede table](#supersede-table)); every
  implementation card cites its row and changes exactly that pin. No pin is deleted.
- **Cost, stated.** A base's uninstall needs the pair removed first; a customer with many bases has many `.custom`
  packages (one per base, folded under each in Studio); the migration of [D11](#d11) is an administrator's ceremony;
  the Setup overlay path customers use today closes once migrated; `__c` is a visible suffix on every customer field;
  a dependent that wants its own item under a name its base already uses renames it — only the paired `.custom` declares an
  override (#28364, #28390), so a partner that wants a different base view ships it under its own name, and a real partner
  need to replace a base item reopens #28390 as its option B with that evidence. Flow customization waits for pinning
  (N-12), so the first thing a customer can override is a view, not a flow.
- **A base upgrade that adds a name a `.custom` item already holds displaces that item.** The base's name has an owner
  and only a declared override is served over it ([D8](#d8) items 1–2), so the pair's item — authored when no base item
  bore the name, hence undeclared — stops being served and becomes an orphan; no door judges a base upgrade today
  (ADR-0141 D3 deferred). N-09 makes the install and upgrade door name each such collision, and N-10 surfaces the orphan
  in the layered read.
- Setup's item pages for the pillar types stop editing; QA checklist items and e2e specs that drive the Setup designer
  as "a sibling door onto the same save" (`docs/qa/platform-checklist/areas/studio-authoring.json`,
  `docs/qa/platform-checklist/areas/ux-conventions.json`, the live `ui/e2e/live/studio-object-designer.spec.ts`) are
  rewritten to the Studio door or marked transitional (N-29). Translations and email templates lose the Setup form; their
  simplified form editor is offered inside Studio's All-metadata area (N-25) — an administrator changing one line of
  mail copy enters Studio, behind `manage_metadata`, and the change is an override in `.custom`.

## Rollout

Tracked by epic [#28236](https://github.com/objectstack-ai/objectstack/issues/28236), which carries the plan of record
below; every child is lane work claimed under the normal protocol, nothing in the subtree carries `pm:epic`
(maintainer, verbatim: 「这些卡都可以放回车队开发吧」 · 「注意不能写epic车队才会认领」). Cards marked *cut after this
record merges* bind no seat before that merge. The item toolbar (N-05) runs **ahead of** every customization card
(「同意新增 2h「Studio 项工具栏」并放在 2a 之前」), and the Studio customization surface waits for the override core
(「我建议先等包级覆盖开发完，再考虑这个界面的修改」).

1. **P0 — in the fleet now**: N-01 this record · N-03 #28238 the undeclared same-name leak ([D8](#d8) item 1) · N-04
   #28148 the ledger switch on the item ([D4](#d4)) · N-05 #28239 the item toolbar ([D1](#d1)) · N-07 #28240 object
   pickers inside the closure · N-27 #28241 the two Setup pages ([D7](#d7)).
2. **P1 — the override core** (cut after this record merges): N-06 change note and actor name (after N-05) · N-08
   spec — the override declaration, the `.custom` constants, the namespace rule, the `__c` reservation, the
   display-property whitelist · N-09 the write gate — admit declared (from `.custom`), refuse undeclared / out-of-closure / excluded type
   / a dependent's declaration ([D2](#d2); precondition: the #28364 count of existing closure same-name rows) · N-10 one effective read across the five read kinds ([D8](#d8)) · N-12 real flow
   version pinning ([D9](#d9) item 4) · N-11 flow override — served over the code package, rebound in one reload,
   ledger identity inherited ([D9](#d9) items 1–3; after N-12) · N-13 the `.custom` ensure door — explicit namespace,
   walled 403 ([D3](#d3)) · N-14 uninstall protection for the pair ([D3](#d3)) · N-15 the per-package customization
   read ([D8](#d8) item 4) · N-16 migrate package-less overlay rows, then close that write ([D11](#d11)).
3. **P2 — Studio customization** (after P1): N-17 customize view / dashboard / report (replaces #28147) · N-18
   customize a flow (after N-12) · N-19 base + `.custom` as one surface ([D3](#d3)) · N-20 permission set "new similar"
   ([D6](#d6)) · N-21 #28149 the clone door → "new similar" (`Blocked-by:` N-13; [D4](#d4)) · N-22 Studio "new similar"
   on a flow · N-23a/b/c object extension — the field-patch whitelist, the `__c` reservation, Studio add-field
   ([D10](#d10)) · N-24 landing counts · N-25 email template and translation editors into Studio.
4. **P3**: N-26 the metadata directory into Studio ([D1](#d1)) · N-28 Setup → Metadata redirects and Packaged automation
   retired ([D4](#d4), [D11](#d11)) · N-29 QA checklist and live e2e to the Studio door · N-30 skills and docs — the
   §1.3 promise pages say what [D2](#d2) delivers.

Landed ahead of this record, reversing no wall: PR #28076 (the browse entry, [D5](#d5)); #27356 row 19 letter A1 (Studio
deletes a writable package's flow from the item menu).

## Status-line pointers

The eight records this record supersedes in part or amends carry, on their Status line and nowhere else, a dated
pointer in the form ADR-0005's line set, added with this rewrite. Six read `· **Superseded in part by
[ADR-0146](./0146-….md)** (2026-10-31) — CLAUSE`: ADR-0005 (the five-type tier), ADR-0048 (§3.3; §3.4 for the closure case), ADR-0126 (D1, D4
wall 1, §7.1; §7.4 moved, §9 first bullet lifted in part), ADR-0131 (D6), ADR-0141 (D3's uninstall item, paired case)
and ADR-0070 (D3's prompt and D5's destination, paired case). Two read `· **Amended by [ADR-0146](./0146-….md)**
(2026-10-31) — CLAUSE`, because no sentence of theirs is reversed: ADR-0009 (the resume reading of `executionPinned`
for `flow`, delivered by [D9](#d9)) and ADR-0029 (D7's contributed items drawn greyed with their source named). The
2026-10-30 draft listed the last three under *At acceptance*; they land with this rewrite.

## Decided here where the rulings were silent (for the maintainer's merge)

Merging accepts them; an objection names the number. The two edges the contract review named beside them — the scope
of Q1's refusal and `action` — were ruled by the maintainer on 2026-10-31 (decision card #28364) and are fixed in
[D2](#d2) and [D9](#d9), not listed here.

1. **The pair's dependency range** is the installed base's major at creation ([D3](#d3)). The range is read at the
   pair's own install or re-install (ADR-0141 D2), not on a base upgrade, which nothing intercepts today (ADR-0141 D3).
   `*` would declare nothing a re-install or a future interception could judge; an exact pin would refuse re-installing
   the pair after any patch of the base. The major is the reversible middle, and its payoff comes with ADR-0141 D3: when
   a base upgrade is intercepted, the pair's `^<major>` is what stops a major upgrade of the base until the
   customization is revisited.
2. **`basedOn` is recorded and never judged** — not silent, and nothing to accept here: the epic's *Not in this epic*
   line rules it, verbatim "upgrade diff / `basedOn` checking (recorded only)". It is listed only so the declaration's
   contract carries the ruling and no card reads `basedOn` as a gate ([D2](#d2)).
3. **The uninstall refusal's shape** is the ADR-0029 extender refusal's family, `409`, from the same door ([D3](#d3)):
   one resource-state conflict for "another package still stands on this one", two causes, one envelope.
4. **The display-property class is defined by a test, not a list** ([D10](#d10)): a property is admitted when changing
   it changes no DDL, no stored value, no validation verdict and no permission; the spec card measures the members
   against `FieldSchema` and publishes them as one closed constant — the whitelist the write gate reads, in the shape of
   [D2](#d2)'s type list; the maintainer's 2026-10-31 reading: the criterion stays, the whitelist is that constant. A
   list written here would be either stale or invented.
5. **A declared override is served within the base's address for all five read kinds, and the base's own document
   stays reachable as the layered read's `code` layer** ([D8](#d8)) — so "Restore package original" needs no second
   read path and the chip needs no computation.
6. **The migration is an administrator's CLI ceremony, idempotent, per base** ([D11](#d11)), in ADR-0131 D10's shape
   — not a boot step: a boot that rewrites rows into a package it creates is the recorded-verdict defect AGENTS.md's
   *Startup registry reads* section names.
7. **`__c` is refused outside `.custom` at publish, at `os validate` and at the install door** ([D10](#d10)) — three
   points, so a Studio author cannot write it into a non-paired package, an `os`-built artifact cannot carry it, and a
   vendor artifact that carries it is refused on entry. The ruling fixes who may use the suffix; the enforcement points
   are this record's.

## Refs

- Epic [#28236](https://github.com/objectstack-ai/objectstack/issues/28236) (rulings, territory, the N-numbered plan;
  supersedes [#28130](https://github.com/objectstack-ai/objectstack/issues/28130), closed not planned).
- Cards: [#28237](https://github.com/objectstack-ai/objectstack/issues/28237) (this rewrite),
  [#28238](https://github.com/objectstack-ai/objectstack/issues/28238), [#28148](https://github.com/objectstack-ai/objectstack/issues/28148),
  [#28239](https://github.com/objectstack-ai/objectstack/issues/28239), [#28240](https://github.com/objectstack-ai/objectstack/issues/28240),
  [#28241](https://github.com/objectstack-ai/objectstack/issues/28241), [#28149](https://github.com/objectstack-ai/objectstack/issues/28149),
  decision card [#28364](https://github.com/objectstack-ai/objectstack/issues/28364) (the scope of Q1's refusal and `action`, ruling record 6540351677);
  decision card [#28390](https://github.com/objectstack-ai/objectstack/issues/28390) (the declarer — ruled A, ruling record 6542177429, scope 6543281223;
  `basedOn` records the base package's version, ruling record 6549129352 on [#28404](https://github.com/objectstack-ai/objectstack/issues/28404));
  PR [#28145](https://github.com/objectstack-ai/objectstack/pull/28145) (closed unmerged; its three wording fixes
  S13–S15 are folded into this rewrite); PR [#28045](https://github.com/objectstack-ai/objectstack/pull/28045) (the
  Proposed draft this rewrite replaces, hand-merged 2026-10-30).
- [#27356](https://github.com/objectstack-ai/objectstack/issues/27356) rows 12, 13, 14, 19, 20, 21 and their landed
  PRs #27376, #27927, #28076.
- ADR-0005, ADR-0009, ADR-0010, ADR-0029, ADR-0048 (and its 2026-10-08 addendum), ADR-0070, ADR-0126, ADR-0131,
  ADR-0141, ADR-0142.
- objectui#12615 (bridge follows package posture), objectui#5813 and objectui#12450 (the Data pillar's tabs),
  objectui#11553 (the package-less scope), objectui#13270 (the clone result's offers).
