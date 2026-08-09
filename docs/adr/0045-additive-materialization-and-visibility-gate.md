# ADR-0045: Additive materialization with a visibility gate — drafts narrow to mutations

**Status**: Accepted (2026-06-12) · **Amended 2026-08-09** (#4829, maintainer ruling 2026-08-04 + window re-ruling 2026-08-07) — the gate moves off `app.hidden` onto a dedicated machine-managed key, `app._unpublished`. The mechanism is unchanged in every other respect; see **"Amendment (2026-08-09): the gate gets its own key"** at the end for what was wrong and why this is a correction of the record rather than a reversal.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0027](./0027-metadata-authoring-lifecycle.md) (staged authoring · draft · publish — **this ADR narrows which writes route through its draft workspace**), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) ("AI never publishes — it drafts" — **revised for additive builds**: AI materializes invisibly; *visibility* is the human gate), [ADR-0038](./0038-build-verification-loop.md) (machine verification gate — retained, moved **before** materialization), [ADR-0037](./0037-live-canvas-draft-preview.md) (Live Canvas — its preview surface becomes trivially real under this ADR), [ADR-0005](./0005-metadata-customization-overlay.md) (overlay model — unchanged as storage, narrowed as preview plane), [ADR-0019](./0019-app-as-consumer-unit.md) (app as the consumer-facing unit — this ADR's gate decides what that unit exposes; ⚠️ the original text cited ADR-0019 for a "`hidden`/launcher contract", which ADR-0019 does not contain — see the 2026-08-09 amendment)
**Consumers**: `@objectstack/objectql` + `@objectstack/runtime` (materialize/teardown, visibility semantics), `@objectstack/rest` (publish = visibility flip for additive packages), `../cloud/service-ai-studio` (blueprint tools switch from stage-draft to materialize-unpublished), `../objectui` (Live Canvas → real app URL; draft preview narrows to mutation diff)

**Premise**: pre-launch, no back-compat debt — specify the target end-state directly.

**Design center**: **the draft *gate* is right; the draft *world* is the wrong implementation for creation.** Review semantics ("nothing the user can see changes without confirmation") are an enterprise requirement and stay. But rendering an entire pending universe through a metadata overlay means teaching every read path in the platform — metadata, analytics, data CRUD, search, flows, permissions, every future surface — to answer "and what if it's a draft?" twice. That adaptation surface is unbounded, and every gap in it surfaces as a broken magic moment. For **additive** creation there is a strictly cheaper gate with perfect fidelity: **build the real thing, keep it invisible, and make Publish a visibility flip.**

---

## TL;DR

1. **Additive builds materialize immediately.** When an AI build (or Studio batch) creates only *new* artifacts — objects, views, dashboards, datasets, apps, seeds whose names collide with nothing published — it writes them as **real, active metadata** with **real tables and real seed rows**, grouped under the build's package. No draft state, no overlay.
2. **The gate moves from lifecycle to visibility.** The built app carries `_unpublished: true`: launchers, home grids, app switchers and end-user nav never show it, and neither does the metadata API; builders/admins reach it by direct URL. **Publish = clear the gate** — instant, reversible, trivially understandable. The read side is `filterAppForUser` in `@objectstack/rest` (amended 2026-08-09: the gate has its own key and does **not** ride on `app.hidden`, which is navigation presentation).
3. **Preview is the real app.** The ADR-0037 Live Canvas iframes the app's *real* URL — full data (seed rows are real rows), full interaction (kanban drags, record creation, filters), zero overlay adaptation. The "draft preview shows an empty shell" class of defect becomes structurally impossible.
4. **Mutations keep the ADR-0027 draft workspace.** Changing or deleting anything *published* — field edits, renames, destructive ops, permission changes — still stages as a draft, surfaces in diff review, and goes live only on human publish. The overlay preview plane (`?preview=draft`) narrows to this purpose: rendering a *pending change to a visible thing*, not a whole pending world.
5. **The ADR-0038 machine gate runs before materialization.** L1 graph lint validates the in-memory build set first; a failed lint materializes **nothing** (the agent repairs and retries). L2/L3 runtime probes then exercise the *real* unpublished app — strictly better signal than probing a synthetic overlay.
6. **Discard = real teardown.** Discarding an unpublished build drops its package's metadata, tables and rows (package-scoped uninstall, ADR-0027 §rollback mechanics). Heavier than deleting overlay rows — and honest: the user is deleting an app, and is told so.

---

## Context — the draft tax, measured

### One session's bill (2026-06-12, local full-stack E2E)

A single browser-level verification pass of the ADR-0037 preview chain (HEAD of all three repos) found **five independent defects, every one of them a "second world" adaptation gap**, not a business-logic bug:

| # | Defect | The seam that failed |
|---|---|---|
| 1 | `GET /api/v1/meta/:type` (rest-server) silently dropped `?preview=draft` — list and item handlers never forwarded `previewDrafts` to the protocol | the *fourth* read path that needed the overlay taught to it (http-dispatcher list, item, `_drafts`, then this) |
| 2 | The SPA's metadata client did not recognize the draft route's response envelope | client-side shape adaptation, again per-path |
| 3 | In-app navigation dropped the `?preview=draft` flag — half the UI rendered the draft world, half the published world | world-mixing at every router seam |
| 4 | `NavigationSyncEffect` diffed the draft world against the published world across the mode swap and began issuing **deletes** for "removed" pages | a read-side feature nearly performed destructive writes because two worlds met in one cache |
| 5 | The magic-moment canvas rendered **"No Apps Configured — Create Your First App"** inside the build preview | the flagship demo, broken by #1–#3 stacking |

Add the standing gap this session confirmed by design rather than by accident: **the preview has no row data.** ADR-0037 P3 taught exactly one consumer (dashboard widgets, via `draftRowsResolver`) to read PENDING seed drafts; lists and kanbans — the surfaces a business user actually judges an app by — render empty until publish. Whenever auto-publish is off (governed orgs), lint fails, or an edit adds an object, the user reviews an **empty shell** and is asked to approve it.

ADR-0038's own incident table tells the same story from the lifecycle side: "seed staged but rows never materialized on publish", "Published! while sample data silently failed" — defects born at the draft→live transition seam.

### Why the tax is unbounded

The overlay approach requires every read path — present and future — to implement draft awareness: metadata lists/items (done, four times over), analytics (done for one widget type), data CRUD (not done), full-text search, flow triggers, permission evaluation, REST/MCP API consumers (ADR-0036 exposes apps as APIs — does a draft app have a draft API?), exports, notifications. Each is a fork: published source vs. overlay source, with caching, invalidation and world-isolation semantics per fork. Defects #1–#5 above are what one slice of that matrix looks like in practice. The matrix only grows.

### How the platforms that won draw this line

- **Power Apps / Retool**: only the *UI layer* drafts; data structures land directly in the real backend. Preview therefore runs real queries against real tables — which is why their preview is never empty.
- **v0 / Lovable / Bolt**: the "draft" is a *complete running sandbox* — full fidelity by construction.
- **Salesforce / Airtable**: structural edits go live immediately; governance happens at environment promotion, not at render time.

No mainstream platform renders a pending world through a metadata overlay. The industry-converged answer is: **previews run real apps**; what varies is where the *gate* sits (visibility, environment, or version pointer).

### Why our own auto-publish policy already concedes the point

The shipped policy (cloud `apply_blueprint` + chat auto-publish) is: **whole-app builds are additive, therefore safe, therefore auto-published** — drafts exist for these builds for the seconds between staging and the auto-publish call. We maintain an entire parallel rendering universe largely for a transition state measured in seconds. The cases where the draft period is *long* (auto-publish off, lint failure, governed review) are exactly the cases where the half-world's gaps — empty tables, broken previews — do the most damage to user trust.

---

## Options considered

**A — Complete the overlay (extend P3 to the data plane).** Teach `/data/:object` reads to synthesize rows from PENDING seed drafts for draft-only objects; read-only preview semantics; in-memory filter/sort/pagination over synthetic rows. *Rejected as the primary path*: it pays the per-read-path tax forever (CRUD writes, search, flows, API consumers all still pending), preview interaction stays fake (no record creation, no kanban drag), and the synthetic row plane adds its own semantics (what does a lookup to a published object's real row mean inside a synthetic result set?). Kept only as: nothing — the narrowed mutation-preview plane needs metadata overlay, not synthetic data.

**B — Shadow environment per build (the v0 model).** Apply each build into a disposable environment; preview = open the real app there; publish = promote. Perfect fidelity, zero adaptation surface. *Rejected for this architecture*: per-environment databases and kernel-per-env multi-tenancy make environment spin-up the platform's most expensive operation (cold boot is minutes today); a per-build-iteration environment multiplies storage and breaks the in-conversation iteration loop (each edit would re-provision). Promotion machinery (ADR-0027 §promote) exists for Dev→Prod cadence, not per-utterance cadence.

**C — Additive materialization + visibility gate; drafts narrow to mutations.** *Chosen.* Real artifacts, real data, invisible until published; the draft workspace serves the case it is actually good at — reviewing a *diff against something visible*.

---

## Decision

### 1. The additivity rule

An apply set (blueprint build or batch authoring call) is **additive** iff:

- every artifact `(type, name)` in the set has **no published row** (new names only), and
- no operation in the set mutates, renames, or deletes a published artifact, and
- every reference from the set into the published world is **read-only** (a lookup *to* a published object is fine; changing that object is not), and
- **nothing in the set would surface on a visible app** — neither through explicit references (a nav entry in a published app) nor through *implicit aggregation*. The canonical implicit case: a new `<object>.<key>` view on a **published** object auto-appears as a tab on that object's page. New-name-ness is not the test; **reachability from the visible surface is**. An artifact end users would see the moment it lands is a *mutation of the visible surface* and routes through the draft workspace, whatever its name.

The server computes this classification — never the model. `apply_blueprint` (and any future batch-apply) partitions a mixed set: the additive partition materializes per §2; the mutation partition stages as ADR-0027 drafts per §5. The classification result is part of the tool's return envelope so the chat can narrate honestly ("3 new objects are live in your unpublished app; 1 change to *Customer* awaits your review").

### 2. Materialization

Additive artifacts write through the **normal registration path** (the same `register`/schema-sync machinery a package install uses): metadata rows active, tables created, seed rows loaded — atomically per ADR-0034 transactional semantics, grouped under the build's package (`app.<name>`, the existing zero-package-UX home). There is no draft state for these rows and therefore no overlay, no `?preview=draft`, no invalidation protocol, no world-swap cache rules.

Ordering inside the build is what the publish path does today (structure → datasets → dashboards → app → seeds), now executed once instead of twice (stage + publish).

### 3. The visibility gate

- The build's `app` materializes with **`_unpublished: true`** (and stays `active: true`). `filterAppForUser` (`@objectstack/rest`) withholds an unpublished app from every metadata response except a builder's, so it is absent from every end-user listing surface (launcher, home grid, switcher) by construction; direct URLs (`/apps/<name>`) resolve for users with builder/admin permission. Objects and views without a visible app referencing them are unreachable for end users by construction; no per-artifact visibility flag is needed in v1.
- **`_unpublished` is machine-managed and excluded from what an author writes.** It is set by the materialization path and cleared by `publish-drafts`; the `_` prefix is the platform's existing marker for the channel tooling stamps onto artifacts (ADR-0010's `_lock` / `_provenance` envelope). ⛔ It is **not** `app.hidden`. `hidden` means "keep this app out of the App Switcher; surface it from the avatar menu" — the personal-settings case, e.g. the built-in Account app — and it never withholds access from anyone. The two are orthogonal and compose: an app can be hidden and published (Account), published and listed (CRM), or unpublished and either.
- **Publish = `_unpublished: false`** — one metadata write, instant, reversible (**unpublish = re-gate**, which no draft model can offer). For governed orgs, the ADR-0027 approval gate wraps this flip exactly as it wraps draft-publish today; what is being approved is now *making a working, inspectable app visible* rather than *promoting an invisible diff*.
- The chat's auto-publish policy is unchanged in spirit: whole-app builds in auto-publish environments clear the gate immediately after the machine gate passes; governed environments leave the app unpublished pending review.

**The complete semantics of invisible.** "Hidden" means **externally unobservable**, consistently across every surface — not merely "absent from the launcher":

- **Discovery**: MCP tool listings, API catalogs, and marketplace/app directories exclude unpublished apps **unconditionally**. A half-built app must never appear in an agent's tool inventory.
- **Direct API** (ADR-0036 apps-as-APIs): REST/MCP calls against a unpublished app return 404 by default — the API analog of an end user pasting the URL. Builder-side integration testing is served by a **short-lived, package-scoped preview token** minted through the ADR-0039 token-scope-tree (no new mechanism); deferred past v1.
- **Outbound side-effects**: notifications, emails, webhooks, and scheduled/triggered flow actions originating from a unpublished app are **suppressed by default**. The app is fully real for the builder interacting *with* it; it never reaches out and touches anyone who can't see it. (Blueprint builds author no flows today, so this is a stated invariant with zero v1 code — written down now so the first user who tests an approval flow inside a unpublished app doesn't email the whole company.)

Publish opens all three gates at once; unpublish closes them again.

### 4. Verification (ADR-0038 alignment)

- **L1 graph lint moves before materialization**: it already runs on the in-memory staged set (`stagedBodies`); under this ADR a failing lint means **nothing lands** — no half-built unpublished app, no cleanup. The agent repairs the blueprint and re-applies.
- **L2/L3 probes improve**: render and data probes exercise the *real* unpublished app — real tables, real seed rows, real dataset queries — before visibility flips. The 0038 incident classes "seed never materialized on publish" and "Published! but empty" cannot recur, because there is no second materialization step at publish time to fail.

### 5. Mutations: the draft workspace, narrowed and sharpened

Everything ADR-0027/0033 says about drafts continues to apply to **changes to published artifacts**: stage → validate → **diff review** → human publish. What changes:

- The **overlay preview plane narrows** to mutation review: `?preview=draft` renders a pending *change* to a visible app (the case where a side-by-side/diff actually beats a live app). The Live Canvas no longer depends on it for builds.
- **Edits to a still-unpublished app are additive by definition** (nothing visible can break): they materialize directly into the unpublished app. The iteration loop — say a thing, see the thing — runs at full fidelity with zero lifecycle friction. Drafting begins the moment the app becomes visible.
- The chat's Changes panel / draft-status surfaces keep their role for the mutation partition; their pending-count source (`/meta/_drafts`) is unchanged.

### 6. Discard, residue, and quotas — the honest costs

- **Discard = trash-can teardown.** Discarding an unpublished build atomically **renames** its package, metadata names, and physical tables into a trash namespace (`__trash_<ts>` suffix), hides them everywhere, and a janitor GCs after **7 days**; restore = rename back (conflict-checked). Rename is O(1), restore is lossless, and — critically for the AI loop — **the namespace frees immediately**, so "丢掉重建同名应用" never collides with a tombstone. The trash window also guards against the *agent* mis-firing a discard inside an ADR-0038 self-repair loop, not just the human. The confirmation still names what is deleted ("Delete the unpublished app *生产管理* and its 60 sample rows"). Iterative re-builds into the same package reuse the existing upsert path rather than discard+recreate. *v1 simplification*: typed-confirmation hard delete; the trash rename lands in v1.1 (discard is low-frequency — "不要了重来" flows through same-package upsert, not discard).
- **Preview-entered data survives publish.** Rows a builder creates while testing the unpublished app are real and remain after the visibility flip. This matches Power Apps/Retool user expectations and is a *feature* (test data carries over), but must be explicit in the publish confirmation, with a one-click "reset to sample data" (re-run seeds) offered at publish time.
- **Hidden apps consume real resources.** They count toward environment quotas (tables, rows, storage). v1 guardrail: a per-environment cap on unpublished apps (entitlement-configurable), enforced at apply time with the ADR-0040 §5 limits pattern (soft prompt before hard cap).
- **Namespace**: materialized names occupy the real namespace. This is not a regression — overlay drafts already reserve the same `sys_metadata` names today.

### 7. Surface changes (objectui / cloud)

- **Live Canvas** iframes `/apps/<name>` (real app). The amber DraftPreviewBar generalizes to an **"Unpublished app" banner** on unpublished apps: same watermark role, same Publish button (now a visibility flip), same exit affordance. Empty/error states from the preview hardening keep their structure with updated copy ("this app hasn't been built yet / failed to load").
- **`apply_blueprint`** (cloud) switches its additive path from `stageDraft` per artifact to materialization; its envelope keeps `drafted`-equivalent reporting (now `materialized`), `verification`, `packageId`, and gains the §1 classification block. The streaming build tree is unchanged — items appear as they land, but what lands is real.
- **`publish-drafts`** for an additive package becomes the visibility flip (+ optional seed re-run); for mutation packages it keeps its current promote semantics.

### Open-core boundary

The **mechanism** — additivity classification, materialize/teardown, the visibility gate, pre-materialization lint hook — is framework, open. The **intelligence** — blueprint design, auto-publish policy, build-repair loops, managed verification — stays in cloud/EE, per ADR-0002 (cloud) "open mechanism, close intelligence".

---

## Consequences

**Gains**
- The "second world" adaptation matrix (defects #1–#5 above, P3's unfinished data plane, and every future read path) is **deleted for the build path**, not completed.
- The magic moment lands on a **living app**: data in every list, every interaction real, in preview as in production — including in governed orgs where auto-publish is off, which is precisely where the empty-shell preview hurt most.
- Publish and unpublish become symmetric, instant, and explainable in one sentence.
- ADR-0038's runtime probes test the real artifact pre-publish; a whole class of publish-transition defects disappears.

**Costs**
- Discard is a real deletion and must be UX'd as one (confirmation, undo-window consideration).
- Hidden apps consume quota; needs the §6 cap.
- Two authoring regimes (materialize vs. draft) must be explained — mitigated by the server owning the classification and the chat narrating it.
- Migration: blueprint tools, publish endpoints, canvas, and the auto-publish chat loop all change in a coordinated (but pre-launch, no-compat) cutover.

## Phases

### v1 — "Magic moment on rails" (the only slice that matters first)

Acceptance, browser-level: *the instant an AI build finishes, the canvas shows a real app — seed rows in every list, kanban drags, record creation works; Publish puts it in the launcher instantly.* Plus three guard branches: failed L1 lint materializes nothing; auto-publish-off leaves the app unpublished behind the banner; discard removes it after a typed confirmation.

1. **Framework**: materialization path for whole-app builds (reuse the package-install register + schema-sync + seed machinery — no new persistence); `_unpublished`-gate visibility-flip publish; L1 lint as a pre-materialization gate (the in-memory lint already exists; the order flips from stage-then-lint to lint-then-land). The one genuinely careful piece: atomicity/teardown on mid-build failure.
2. **Cloud**: `apply_blueprint` swaps `stageDraft` for materialization (contained in `blueprint-tools.ts`); envelope reports `materialized` + the §1 classification; auto-publish becomes the visibility flip. Streaming build tree, lint gate, package binding unchanged.
3. **objectui**: canvas iframes `/apps/<name>` (drops `?preview=draft` for builds); amber bar generalizes to the "Unpublished app" banner (Publish = flip); discard with typed confirmation.

**v1 explicitly defers**: the full mixed-set classifier (v1 covers whole-app builds only — blueprint prompts already exclude existing objects, so "all names new + nothing reachable from visible apps" suffices; incremental edits keep today's draft + diff path, whose review surfaces already shipped); trash-can discard (v1.1); preview tokens (unpublished-app API simply off); outbound suppression (stated invariant, no flow authoring in blueprints yet); quota cap (entitlement wiring exists, flip on in v1.1).

### v2+

4. Mixed-set partitioning (additive partition materializes, mutation partition drafts, one envelope).
5. Trash-can discard + 7-day GC; quota cap on unpublished apps.
6. ADR-0039 preview tokens for unpublished-app API integration testing.
7. **Retire**: P3 synthetic-data plumbing beyond what mutation diff review needs; world-swap cache rules in `MetadataProvider` narrow accordingly.

## Resolved questions (decided 2026-06-12)

1. **Per-artifact visibility** — **not in v1, and not as a visibility flag at all.** The real hazard it pointed at (new artifacts implicitly surfacing on visible apps) is closed by the §1 reachability clause instead. True per-artifact visibility is an *audience-staged rollout* feature (admin-first dashboards, soft launches) — a distinct, likely-commercial capability to be specified when demanded, not built incidentally here.
2. **Discard window** — **trash-can rename + 7-day GC + lossless restore** (§6); v1 ships typed-confirmation hard delete, trash in v1.1.
3. **Unpublished-app API exposure** — **default fully dark** (§3 "complete semantics of invisible"): excluded from discovery unconditionally, direct calls 404, outbound side-effects suppressed; builder integration testing later via ADR-0039 package-scoped preview tokens.

---

## Amendment (2026-08-09): the gate gets its own key

**Ruling**: maintainer, 2026-08-04 (direction) and 2026-08-07 (window — lands in v17), on [#4829](https://github.com/objectstack-ai/objectstack/issues/4829). **Change**: the publish gate is `app._unpublished`, a machine-managed key. It was `app.hidden`. Nothing else in this ADR changes — materialize-invisible, publish-as-a-flip, the "complete semantics of invisible", discard, quotas and the phase plan all stand, on a different carrier.

### What was wrong

This ADR never introduced `hidden`; it **borrowed** it. §2/§3 as originally written cited "the ADR-0019 launcher contract (`hidden`, `active`)" as an existing read side to ride on. That contract does not exist: **ADR-0019 does not contain the word `hidden`**, and never discussed launchers, the avatar menu, or the Account app. The reference was dangling from the day it was written, which is why nothing caught the collision it created.

What `hidden` actually is, and was already, is a **navigation-presentation** key with its own written contract in `packages/spec/src/ui/app.zod.ts` — born in the same commit as the built-in Account app (74470ad44, 2026-05-28) and saying, in as many words, that *"hidden apps stay fully routable and permission-checked"* and that the shell surfaces them from the avatar menu. So from 2026-06-12 one boolean carried two contracts that contradict each other on the only question that matters: **may a normal user reach this app?**

The failure was not theoretical, and it was silent in the way this repo's ADR-0078 class always is. `filterAppForUser` read `hidden` as the access gate, so the platform's own `account` app — authored `hidden: true` on purpose — was erased from `GET /api/v1/meta/app` for every user without `studio.access` / `setup.access`. Password changes, avatar, linked accounts, active sessions and the inbox were unreachable behind an "App not available — it may still be publishing" screen. Anyone holding `setup.access` saw a completely healthy system, so it survived a release candidate and shipped a downstream workaround (`os-project-titanwind-ehr` PLAT-DEF-040: a startup plugin pushing an env-level `{hidden:false}` overlay, whose visible side-effect — "Account" appearing in the App Switcher — is this amendment's argument in miniature).

### Why a new key rather than removing the gate

The first attempt at #4829 proposed simply taking `hidden` out of the access decision. That was refused, correctly: the gate is §3 of an **Accepted** ADR with pin tests and a live `publish-drafts` implementation behind it, so deleting it in a patch would reverse a recorded decision by side effect (Prime Directive #13). It is also the worse failure direction — a gate that fails **open** exposes a half-built app to real users, silently, which is strictly worse than the over-restriction being fixed.

### Why the key is machine-managed

Presentation and lifecycle are orthogonal concepts; compressing them into one boolean is the root cause, not the symptom. Splitting them restores both contracts, and the split is only durable if the lifecycle half cannot be authored:

- `hidden: true` is the spelling a human — or an AI (ADR-0033) — reaches for naturally on a personal-settings app, because that is what the spec's own docblock teaches. Under this amendment that spelling is bounded to navigation, so the worst an author can do with it is a launcher placement.
- `_unpublished` is nobody's natural spelling. It is written by the materialization path and cleared by `publish-drafts`, and its `_` prefix is the platform's existing marker for the machine channel (ADR-0010's `_lock` / `_provenance` / `_packageId` envelope; the same prefix `lintAuthoredRecordKeys` skips as "tooling stamps this, an author does not"). The `AppSchema` strict-door also answers the author-shaped near-misses — `unpublished`, `published`, `draft` — with a prescription that says *do not author publish state*, rather than routing them onto the key.

It is nonetheless **declared** on `AppSchema` rather than omitted, because the write path validates against that very schema (`saveMetaItem` → 422; `Registry.validate('app', …)` → `AppSchema.parse`). An undeclared key would make the platform's own flip unwritable.

### Migration

Stored `sys_metadata` app rows carrying `hidden: true` were written under the old regime, where that value uniquely meant *unpublished* — the code-declared Account app is a package artifact and never enters `sys_metadata`, so there is no ambiguous population. They are rewritten mechanically by the ADR-0087 D2 conversion `app-hidden-to-unpublished`, which replays on every stored-row rehydration seam (`applyConversionsToStoredItem`) as well as through `os migrate meta`.

### Anchors

The two load-bearing implementation sites are pinned in `scripts/adr-anchors.json` — `packages/rest/src/rest-server.ts` (the gate) and `packages/runtime/src/domains/packages.ts` (the flip). Neither carried an anchor before, which is the recurrence shape Prime Directive #13 names: the files that implemented this ADR's §3 never said which decision they were standing on, so the next author could not have known that changing them was changing a decision.
