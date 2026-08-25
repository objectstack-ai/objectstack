# ADR-0126: The platform customization model for packaged metadata — three regimes, one activation ledger

**Status**: Proposed (2026-08-25) — awaiting the maintainer's hand-merge, which is itself the
acceptance act for a governed surface (Prime Directive #14) **and the ruling that settles the
tentative flow-instance directions in §7** (chartered on
[#12049](https://github.com/objectstack-ai/objectstack/issues/12049); ⛔ none of §7 is settled
until this merges).
**Deciders**: maintainer charter, 2026-08-25, live PM chat, verbatim and untranslated:
「要整体评估除了流程还有哪些需要自定义的也有类似的问题，开始写adr」, following
「很多所有的元数据都有类似的个性化需求，要统一考虑。」
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (org overlay + the two-tier
write model), [ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md)
D7/D9 (contributor kinds, navigation contributions),
[ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), the
[#11513](https://github.com/objectstack-ai/objectstack/issues/11513)
lock-and-clone ruling (2026-08-24, verbatim: 「同意 第一步(创业阶段,Salesforce 式)」), the
[#11665](https://github.com/objectstack-ai/objectstack/issues/11665) flow design
([comment 5404974967](https://github.com/objectstack-ai/objectstack/issues/11665#issuecomment-5404974967))
and its 2026-08-25 maintainer-discussion record
([comment 5406672100](https://github.com/objectstack-ai/objectstack/issues/11665#issuecomment-5406672100))
**Evidence**: the measured per-type survey on #12049
([comment 5406807988](https://github.com/objectstack-ai/objectstack/issues/12049#issuecomment-5406807988)),
pinned to `origin/main` `0b048393faa98151600598bcebf2ad905ee7021f`. Load-bearing facts are
re-cited inline; the survey carries the instruments and positive controls.
**Consumers**: every seat that designs or reviews a post-install customization surface; the
#11665 implementation cards; the permission-set convergence card; `packages/platform-objects`
(the ledger object, when built); `content/docs` (the capability-page promises §1.3 names)

---

## TL;DR

The platform ships packaged apps and refuses nearly every post-install change to them, while two
shipped docs pages promise "install with one click, then customize in Studio". Three customization
mechanisms already exist — org **overlay** for exactly five presentation types, **clone-to-
customize** for permission sets, package-grain **extend** for objects and app navigation — and
each was invented per type, with its own ledger. This ADR writes the model down once:

1. **Three regimes, assigned by what the artifact does** (§3): presentational → overlay;
   behavioral → clone + takeover, ⛔ never silent override; structural → extend. Code-only types
   sit outside customization entirely.
2. **One generic data-plane activation ledger** for the clone+takeover family (§4):
   `sys_metadata_activation` — operational row state per packaged artifact.
   `sys_metadata` remains the **sole definition ledger**; the activation ledger stores no
   definitions, ever.
3. **Install-level scope now, operator-gated writes in multi-org postures, org column reserved**
   (§5).
4. **The walls stand** (§6): the #6190 phantom-overlay wall (no `allowOrgOverride` flip on a
   behavioral type, under any pressure), the sole-definition-ledger rule, and the
   upgrade-vs-choice separation.
5. **Flows are the first consumer** (§7, the worked example); permission sets converge in a later
   card; the five overlay types are untouched (§8).

New per-type customization questions stop arriving at the decision inbox: a new mechanism is
admitted by naming its regime under §3's rule, or it is not admitted.

---

## 1. Context

### 1.1 What exists today — measured, not recalled

The survey ([#12049 comment 5406807988](https://github.com/objectstack-ai/objectstack/issues/12049#issuecomment-5406807988))
enumerated all **27 declared metadata types** (`DEFAULT_METADATA_TYPE_REGISTRY`,
`packages/spec/src/kernel/metadata-plugin.zod.ts:654` — the total universe per #8586, plus the
dynamic-kind channel for plugin-registered kinds such as `connector`). The write door partitions
them into three tiers by flags × item provenance (`packages/metadata-protocol/src/protocol.ts:13227-13260`):

| Tier | Types | A packaged item can be… |
|:--|:--|:--|
| **A — org-overlayable** | view, dashboard, report, translation, email_template | overlaid env-wide and per-org (ADR-0005; pinned by identity in `protocol.org-scoped-write-refused.test.ts`) |
| **B — runtime-create only** | object, hook, seed, mapping, page, app, action, dataset, flow, datasource, external_catalog, doc, book, permission, position, tool, skill | **not customized at all** — writes against the packaged item answer 403 `NOT_OVERRIDABLE`; only brand-new sibling items can be authored |
| **C — code-only** | field, job, api, capability, agent | nothing — no runtime write channel exists |

Three real mechanisms operate across those tiers, each invented separately:

- **Org overlay** (ADR-0005): tier A only. Per-org rows for any other type are **phantom writes**
  — the #6190 measured defect (`packages/metadata-core/src/meta-write-org-scope.ts:16-24`).
- **Clone-to-customize** (#11513, permission sets only): server-side lock on the packaged base
  (`packaged-permission-set-lock.ts`), a clone action demanding a new name, and — the piece this
  ADR generalizes — the ruling that **switching a packaged artifact off is row state, not a
  definition write** (`permission-set-projection.ts:1128-1145`, #4669).
- **Extend** (`objectExtensions`, `packages/spec/src/data/object.zod.ts:2920`; navigation
  contributions, ADR-0029 D7): a package adds fields/validations/indexes to another package's
  object, or nav items to another package's app, merged at boot. Package-grain, additive,
  upgrade-safe.

And one **paper** mechanism: `packages/spec/src/kernel/metadata-customization.zod.ts` declares a
three-layer (system/platform/user) overlay protocol with field-level change tracking — exported,
published in the reference docs, and consumed by **zero** runtime packages
([#12057](https://github.com/objectstack-ai/objectstack/issues/12057)). §6.4 records its
disposition so it cannot be mistaken for this model.

### 1.2 Why per-type invention had to stop

#11665 (packaged flows) was about to mint the third regime instance with its own ledger shape.
The maintainer ruled the question platform-wide instead (the charter quotes above): most metadata
types have the same personalization need, so the model is decided **once**, and per-type cards
consume it instead of re-litigating it.

### 1.3 The shipped promise

Two published pages promise post-install customization generically —
`content/docs/capabilities/integrations.mdx:17` (*"install complete apps … objects, views, flows,
dashboards, and seed data included, **then customize in Studio**"*) and
`content/docs/build-without-code.mdx:37` (*"ready to customize in Studio"*). Measured against the
tier table, the promise is keepable today for views and dashboards, and for **no tier-B type**.
This is stronger pull than any wish-list: it is a shipped claim the platform cannot keep, and the
flows half of it is the #11665 breach specifically.

---

## 2. Decision rule (D1): regime follows what the artifact DOES

The regime of a metadata type is decided by one question — **what happens when two versions of
the artifact are live at once, or when a customization is wrong?**

- **Presentational** (render-time; a wrong overlay renders wrong, side-effect-free)
  → **Overlay** (Regime O). Per-org divergence is safe by construction; ADR-0005's admission
  pair (overlay schema + written render-only rationale) is the gate.
- **Behavioral** (runs with side effects — fires triggers, writes records, grants access, sends
  mail; two live versions double-fire, a silent replacement mis-fires invisibly)
  → **Clone + takeover** (Regime C). The packaged base is locked and refused loudly at the write
  door; customization is a NEW org/install-owned artifact plus an explicit, ledger-recorded
  takeover. ⛔ Never silent override, never an overlay read path.
- **Structural** (schema/wiring the physical world depends on — tables, columns, connections;
  per-org divergence diverges DDL)
  → **Extend** (Regime E). Additive contributions from another package (`objectExtensions`,
  navigation contributions), at package grain. The base is never edited; the extension is itself
  a packaged artifact with package provenance.
- **Code-only** types (field, job, api, capability, agent — each closed by its own recorded
  ruling) sit **outside** the model: customization = ship a new package version. This ADR does
  not reopen any of them.

A **new metadata type** (or newly admitted dynamic kind) must declare its regime at admission,
in its registry-entry comment, using this rule. A customization mechanism that fits none of the
three regimes is not a gap in this ADR — it is a signal the mechanism is wrong (Prime Directive
#5). Items of dynamic kinds default to Regime C posture (locked base, clone by re-authoring)
until their kind declares otherwise, because "behavioral" is the safe assumption for an artifact
the platform cannot classify.

## 3. Per-type assignment (D1, continued)

From the survey's per-type table; classes are the survey's measurements, not aspirations.

| Regime | Types | Notes |
|:--|:--|:--|
| **O — overlay** | view, dashboard, report, translation, email_template | Unchanged, exactly these five. Promotion into this set is an ADR-0005 admission-pair revision, never a registry edit (the #6483 rollbacks are the precedent). |
| **C — clone + takeover** | **flow** (first consumer, §7) · **permission** (landed machinery, converges later — §8) · pre-charted as pull appears: hook, action, tool, skill, position | All behavioral tier-B types. Each type's implementation is its own card consuming this model; the ledger (§4) is shared. |
| **E — extend** | object (fields/validations/indexes via `objectExtensions`) · app (navigation via ADR-0029 D7 contributions) | Already live. No ledger involvement: the customization IS a package, and package identity supplies provenance and upgrade isolation. |
| **outside** | field, job, api, capability, agent (code-only) · seed, external_catalog (one-shot / derived — nothing durable to customize) · datasource (origin-gated: code-defined read-only, runtime-created free) | Recorded so their absence from the regimes reads as decided, not overlooked. |
| **unassigned, deliberately** | page, dataset, doc, book, mapping | Presentational/content tier-B types with no measured customization pull beyond re-authoring a sibling. Today's posture (locked base + free sibling authoring) stands. First real pull picks a regime **by the D1 rule** — likely O via the ADR-0005 admission pair (page/dataset/book) — and does so in an ADR-0005 revision, not ad hoc. |

Two clarifications the survey forces:

- **Managed extension fields** (`plugin-auth/src/managed-extension-fields.ts`) are **not** a
  regime: a build-time ownership declaration between ObjectStack and the embedded auth library on
  four sys objects. Its collision rule (an extension name must never collide with the base
  surface, gated at build) IS adopted as Regime E prior art.
- Regime E is **install-grain, not per-org**. A tenant wanting per-org structural divergence is
  asking for a different physical schema per org — refused by the same shared-DB invariant
  ADR-0005 records. That refusal is part of the model.

---

## 4. Decision (D2): one generic activation ledger — `sys_metadata_activation`

The clone+takeover family shares **one data-plane platform object**. Proposed name:
**`sys_metadata_activation`** — it joins the existing data-plane siblings of the definition store
(`sys_metadata_history`, `sys_automation_run`, `sys_flow_dispatch`) and says what it is: the
activation/replacement record for metadata artifacts. It is declared in
`packages/platform-objects` like its siblings, so it needs **zero `packages/spec` surface**
(#11665 §6 item 1).

| Column | Type | Meaning |
|:--|:--|:--|
| `metadata_type` | string | The artifact's registry type (`'flow'`, `'permission'`, …) |
| `name` | string | The packaged artifact's machine name |
| `package_id` | string | The package that ships the base artifact |
| `organization_id` | string, **nullable — reserved** | NULL today (install-level row, §5); the per-org dimension is an additive column later, never a redesign |
| `active` | boolean | Is the packaged artifact armed for this scope |
| `replaced_by` | string, nullable | Machine name of the org/install-authored replacement artifact, when a takeover designates one |
| `cloned_from` | `{ package, name, version }`, nullable | Provenance of the designated replacement: what it was cloned from and the base's version **at clone time**. Provenance, ⛔ not upgrade linkage — used for nothing at runtime; it is what lets a surface say *"clone based on v3, base now v5"* (§7.4) without diff machinery. |

Uniqueness: one row per `(metadata_type, name, organization_id NULL-collapsed)`; absence of a row
means the packaged default — **active, not replaced**. The ledger is written by the takeover
actions and read at each runtime's own consult point; an empty ledger changes nothing anywhere.

**What the ledger is NOT:**

- ⛔ **Not a definition store.** `sys_metadata` remains the **sole definition ledger** — the
  maintainer probed exactly this in the 2026-08-25 discussion, and the recorded grounds are the
  #6190 phantom-overlay wall and the upgrade-vs-choice separation (§6). The activation ledger
  holds booleans, names and provenance; never fields, nodes, grants, or any fragment of an
  artifact body.
- ⛔ **Not a metadata type.** It is an ordinary platform object with ordinary rows: an ordinary
  `organization_id` column and an ordinary read path — the construction #6190's measurement
  leaves open, where an org-scoped `sys_metadata` row has neither (F3). The #11513 deactivation
  carve-out (row state is not a customization of the definition, #4669) is the precedent
  validating this plane split.
- **Not a central interceptor.** Consult points stay **per-runtime**: the automation engine
  consults it in `execute()` beside the existing `FLOW_DISABLED` guard (#11665 §2.3 — the one
  seam every entry path crosses); the permission projection keeps its own row-state door until
  convergence (§8). Each consumer documents its consult point; the ledger imposes no global
  dispatch layer.

## 5. Decision (D3): scope and write authority

- **Install-level rows now.** Every row is written with `organization_id NULL`. For the default
  `single` posture — one logical tenant (`packages/spec/src/security/tenancy-posture.ts`) —
  install-level and org-level are the same scope, so this is complete for the majority shape at a
  fraction of the surface (#11665 Fork A, ①–④ analysis).
- **Operator-gated in multi-org postures.** In `group`/`isolated` postures the ledger write
  requires the platform-operator capability: **a tenant org admin must never flip an
  install-wide switch**. This is #10243 made durable in the correct direction — that incident
  measured a tenant flipping a shipped flow off environment-wide through an unscoped in-process
  map; a durable install-wide row writable by tenants would be the same leak with persistence.
- **The org column is reserved, and per-org semantics are pre-charted narrowly:** when a real
  multi-org customer asks, per-org takeover is added for **record-change-triggered flows only**
  (the one trigger type whose context carries an organization — F4: record-change 5 matches,
  schedule/time-relative/api 0). A per-org takeover attempted on any other trigger type **refuses
  loudly at the moment of the attempt, naming the trigger type** — never a silent fallback to
  install scope. A3 (plumbing an org into the other trigger types) is **not opened**; it is a
  product question ("which org does a nightly sweep belong to"), not a plumbing one.

## 6. Decision (D4): the walls, restated so no implementation card re-derives them

1. **The #6190 phantom-overlay wall.** Any design that needs `allowOrgOverride` flipped on a
   behavioral type has drifted back into #6190 — that is a stop-and-report, not a pin to update.
   The identity pin (`protocol.org-scoped-write-refused.test.ts`, exactly five overlay types)
   turning red on such a flip is the pin working. Q2's rejected option (b) is this wall's
   corollary: takeover-by-name-redirection is an overlay **read** path under another name, and is
   rejected on the record (2026-08-25 discussion).
2. **Sole definition ledger.** Definitions live in `sys_metadata` (or the shipped artifact),
   nowhere else. A customization that wants to store a definition fragment anywhere but a new
   artifact row is out of contract.
3. **Upgrade-vs-choice separation.** Package upgrades rewrite the packaged BASE (definitions);
   they never write the ledger — the ledger records the customer's **choices**, and no upgrade
   un-makes a choice. The converse holds too: taking over never blocks or edits the base's
   upgrade stream. The only place the two meet is the §7.4 factual notice, computed from
   `cloned_from.version` at read time.
4. **The paper protocol is not the model.** The three-layer
   `metadata-customization.zod.ts` surface (#12057 — exported, documented, zero consumers) is
   **superseded by this ADR as a matter of record**: nothing may build against it, and its
   retirement (ADR-0049 remove side) or re-scoping to what ADR-0005 actually implements is
   chartered as an implementation card. Until that card lands, the reference page it generates
   must not be cited as the customization architecture.

---

## 7. The worked example: packaged flows (first consumer)

Everything in this section is the 2026-08-25 maintainer discussion's tentative direction,
incorporated as required by #12049. **Provenance: live chat; the final ruling is the maintainer's
merge of this ADR — ⛔ none of the following is settled until then.** Implementation stays on
#11665's cards; this section is the contract they consume.

### 7.1 Clone (Fork C: C1 + C3)

- **New machine name, mandatory** (the #11513 shape exactly). ⛔ No same-name clone in a second
  package: storage legitimately holds both — the uniqueness index keys on
  `(type, name, organization_id, COALESCE(package_id, ''))` (ADR-0005 amendment, #6825; ADR-0048
  governs the cross-package coexistence) — and the engine's name-keyed flow map makes the winner
  insertion-order: measured as a silent, non-deterministic replacement (#11665 §2.2; #11997
  tracks the shadow diagnostics independently of this model).
- **Whole-definition copy — ⛔ never param-list assembly.** The clone copies the parsed
  definition and mutates only `name`/`label`/`status`. #11703 measured the alternative: a clone
  assembled from an enumerated facet list silently dropped three of six facets; a flow has far
  more facets than a permission set. (#11753 carries the objectui half: carried-over definition
  blobs are not editable form fields.)
- **Provenance recorded**: the takeover row's `cloned_from` captures `{package, name, version}`
  at clone time (§4). Provenance, not linkage — upgrades keep flowing to the base untouched
  (#11513's ruled non-goal stands).

### 7.2 Takeover (Fork A: A1; Q4: two steps)

- Two **deliberate** steps: (1) clone; (2) take over — write the ledger row
  (`active: false, replaced_by: <clone>`). An admin may clone for inspection without changing
  runtime behaviour; the half-done state (cloned, not taken over, packaged original still
  running) is a **displayed state, never silence** (§7.4).
- Enforcement seam: `execute()`-time refusal beside the existing `FLOW_DISABLED` guard, reusing
  the `FLOW_DISABLED` code (no new ADR-0112 ledger entry; the distinction rides the message —
  #11665 §6.3). The install-level row may **also** unbind the trigger, preserving today's
  documented `toggleFlow` semantics; a future per-org row cannot unbind (the hook is registered
  once env-wide) and is an entry-time refusal only — a stated cost, accepted.
- The durable ledger row **replaces** the process-local `flowEnabled` map as the sanctioned
  off-switch for packaged flows, retiring the #10243 leak's mechanism rather than refining it.

### 7.3 The subflow cascade (Q2: option (c))

A takeover of flow B is **refused while any packaged flow references B as a subflow, and the
refusal names the callers**. Rationale on the record: option (a) ships a silent late failure
inside the caller; option (b) — resolving `execute('B')` to the replacement — is name
redirection, rejected under wall §6.1. The refusal is honest, actionable (take over the callers
first, or don't), and preserves "packaged code calls what it names".

### 7.4 The surface (Fork D: leaning D2; Q3)

- **Leaning D2 — a Setup page for packaged automation** (final call rides this ADR's merge):
  packaged flows with their activation state and the clone/takeover actions, contributed the way
  `nav_permission_sets` is (`security-plugin.ts:974`). The maintainer corrected the record here:
  automation UI is **Studio-only today** (`studio.app.ts:234-239`), so this page is new work, and
  the Setup permission-set page is the precedent shape. Studio keeps the editing; Setup gets the
  operational state. Minimum honest content per packaged flow: on/off for this scope · designated
  replacement, if any · the §7.1 provenance.
- **Q3 — a one-line factual notice, no diff machinery**: *"clone based on v3, base now v5"*,
  computed from `cloned_from.version` against the installed base version. ⛔ No diff-vs-base, no
  `drift_status` columns, no "Needs Attention" view — that is the ServiceNow-style layer the
  2026-08-24 permission-set ruling recorded as deliberately unchartered, and it stays deferred
  (D3 in #11665's fork D table). Saying "no drift information exists" plainly beats a
  `customized` flag that the #11513 precedent measured going silently wrong.

---

## 8. Decision (D5): convergence plan

1. **Flows first** — #11665's implementation cards consume §7 once this ADR merges (that card is
   `Blocked-by:` #12049 by its own record).
2. **Permission sets converge in a later card.** The landed #11513 machinery (lock, clone action,
   row-state `active`, drift detection of the enforced copy) **stays valid meanwhile** — it is
   the regime's first instance, not a violation of it. The convergence card decides how
   `sys_permission_set.active` and the generic ledger relate (projection vs migration), and it
   inherits §4's walls; nothing about it is urgent, because the semantics already match.
3. **The five overlay types are untouched.** No overlay-type work is chartered, implied, or
   permitted by this ADR.
4. **Docs**: the §1.3 promise pages are corrected to promise what each regime actually delivers
   (own card, docs lane) once the flow surface exists — not before, which would trade an
   over-promise for a differently-shaped one.
5. **The paper protocol** (#12057) gets its enforce-or-remove card per §6.4.

## 9. Explicitly not chartered (recorded so silence cannot be read as consent)

- The ServiceNow-style overlay layer (badge / customization list / diff-vs-base / revert /
  upgrade skip-report) — recorded as the mature direction **if** customer pull for in-place
  customization appears; deferred again here.
- A3 (org-scoping the schedule / time-relative / api trigger contexts).
- Automatic re-pointing of references on clone (no reference index exists — #11665 §3.2; the
  clone's references stay pointed at what the original pointed at, and the surface tells the
  admin so).
- Reopening any code-only type (field, job, api, capability, agent).
- Any edit to `packages/spec` for the ledger itself (it is a platform object; §4).

## 10. Consequences

- A per-type customization request stops being a design question: classify by §2, apply the
  regime, consume §4's ledger if Regime C. The decision inbox sees new customization questions
  only when a type resists the D1 rule — which is the signal worth a human ruling anyway.
- The published "customize in Studio" promise becomes narrow-true (tier A), then broader-true as
  Regime C surfaces land, instead of broadly false.
- Two silent-failure classes are structurally closed for Regime C types: the double-fire (clone
  running beside the base) and the silent replacement (same-name shadow), both measured in
  #11665. The half-done state remains possible by design (Q4: two steps) — but as a displayed
  state, never a silent one.
- AI authors get one rule per regime instead of per-type folklore: a locked base that refuses
  loudly with the sanctioned path in the refusal message is the shape that keeps AI-written
  metadata from guessing (the axis-③ analysis in #11665's fork recommendations, adopted).

## Refs

#12049 (charter + survey) · #11665 (flow design + discussion record) · #11513 / #11702 / #11703 /
#11753 (permission-set precedent) · #6190 (phantom overlay) · #10243 (env-wide toggle leak) ·
#11997 (same-name shadow diagnostics) · #12057 (paper protocol) · ADR-0005 · ADR-0029 · ADR-0048 ·
ADR-0049 · ADR-0087 · ADR-0088 · ADR-0105 · ADR-0112
