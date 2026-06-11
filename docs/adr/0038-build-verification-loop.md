# ADR-0038: Build Verification Loop — the agent builds, verifies, and corrects itself

**Status**: Proposed (2026-06-11)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (drafts as the staging layer — this ADR **replaces its human-approval assumption for AI builds** with a machine gate; HITL stays for destructive actions), [ADR-0021](./0021-analytics-dataset-semantic-layer.md) (datasets — what most verification probes exercise), ADR-0037 / [framework#1694](https://github.com/objectstack-ai/framework/pull/1694) (Live Canvas — the *human-visibility* complement to this ADR's *machine-verification*)
**Consumers**: `@objectstack/service-analytics` + `@objectstack/objectql` (verification probes), `../cloud/service-ai-studio` (graph lint, `verify_build` tool, self-correction protocol, eval intelligence), `../objectui` (build health card in chat), `ai_eval_cases`/`ai_eval_runs` (existing, currently-unused storage)

**Premise**: pre-launch, no back-compat debt — specify the target end-state directly.

**Design center**: **never make correctness depend on a human looking.** Humans are the laziest component in the system — they will not review, and the magic moment auto-publishes before they could. The agent that builds an app must be the same loop that verifies it and corrects it; a human is *informed* of the outcome, never *required* for it. The only reviewer that scales with AI-speed authorship is the machine.

---

## TL;DR

**The problem, measured.** In one day of live verification (2026-06-10/11), six agent-authored defects shipped to a staging tenant — every one of them **passed schema validation** (`_diagnostics: valid`) and every one was found by a *human manually browsing*:

| # | Defect | Why validation missed it |
|---|---|---|
| 1 | Dashboard widgets bound a `dataset` that didn't exist | reference *between* artifacts — single-artifact Zod can't see it |
| 2 | Widget `values:["amount"]` matched no measure name in the dataset | cross-artifact name agreement |
| 3 | Seed staged but rows never materialized on publish | runtime effect, invisible to schema |
| 4 | Dataset queries returned 0/empty on populated objects (4 stacked infra bugs) | only a *real query* reveals it |
| 5 | "Published!" while sample data silently failed to load | result-reporting gap |
| 6 | View metadata `type:'list'` rendered as a red "Unknown component type" box | renderability is a *renderer* contract, not a schema |

Schema-valid ≠ renders ≠ returns data ≠ matches intent. Each is a separate verification plane, and today only the first exists.

**Decision.** Ship a five-layer **Build Verification Loop (BVL)** that runs *inside* the build turn and *after* publish, feeding every failure back to the agent for bounded self-correction:

- **L1 Graph lint** (draft-time, deterministic): cross-artifact reference resolution over the staged set.
- **L2 Renderability check** (pre-publish, deterministic): every artifact's renderer translation produces a *registered, typed* schema; every dataset compiles.
- **L3 Runtime probes** (post-publish): row counts per seeded object; one real query per widget; generalizes the `seedApplied` pattern.
- **L4 Self-correction protocol**: L1–L3 results are returned **to the agent** (`issues[]` in tool envelopes + a `verify_build` tool); the agent fixes and re-verifies, bounded retries; the chat shows a build-health card, not a plea for review.
- **L5 Agent CI**: golden-prompt eval suite run headlessly per deploy/nightly against an ephemeral environment, persisted in the existing `ai_eval_cases`/`ai_eval_runs` objects.

**Gate semantics change**: for AI whole-app builds, **the verification loop replaces the human approval gate**. A build auto-publishes only when L1+L2 pass; L3 failures trigger self-correction; an unrecoverable build *stays draft* and says so honestly. HITL approval remains **only** for destructive/irreversible actions (ADR-0033 pending-actions) — that is safety, not quality review.

**Open-core boundary**: verification *mechanisms* (graph resolution, render contracts, query probes, eval storage) are open framework; *what to verify and how to judge intent* (lint rule packs, golden prompts, the LLM intent-review) is cloud intelligence.

---

## Context

### Why the existing defenses don't compose into a loop

| Defense (exists today) | Catches | Systemic gap |
|---|---|---|
| Per-type Zod at `stageDraft` (ADR-0033) | malformed single artifacts | all six defects were single-artifact-valid |
| Draft gate + human Publish | nothing in practice | magic moment auto-publishes; humans don't review |
| propose → confirm → apply | wrong *plan* | confirms intent, not product quality |
| Deterministic normalization (dataset auto-create, widget-ref derivation, viewType→grid; shipped 2026-06-10/11) | makes *known* mistakes impossible | reactive: one fix per discovered failure mode |
| `seedApplied` reporting | seed materialization failures | one probe, one artifact type — the pattern, not the system |
| `ai_eval_cases` / `ai_eval_runs` objects | — | empty skeleton, wired to nothing |

The strongest defense — deterministic normalization — should remain the first resort ("make the mistake impossible"). The BVL is for the unbounded remainder: an agent is a generator of *novel* mistakes, so the system needs a *general* verifier, not an ever-growing list of special cases.

### The correction loop already works — it's just manual

The live incident that motivates L4: a human told the agent *"the Spending Dashboard shows Dataset 'expense' not found — fix it"*, and the agent diagnosed, created the missing dataset with exactly-referenced measure names, and offered Publish — correctly, in one turn. The agent's repair capability is not the gap. **The gap is that a human had to be the error transport.** The BVL is, at its core, replacing that human with the build pipeline.

---

## Decision

### The verification contract

Every layer emits the same shape, so the agent, the chat UI, and the eval harness consume one stream:

```ts
interface BuildIssue {
  layer: 'graph' | 'render' | 'runtime' | 'intent';
  severity: 'error' | 'warning';
  artifact: { type: string; name: string };           // what is broken
  ref?: { type: string; name: string; member?: string }; // what it points at
  code: string;        // e.g. 'dangling_dataset', 'unknown_measure', 'typeless_schema',
                       //      'empty_query', 'seed_not_applied', 'intent_mismatch'
  message: string;     // agent-actionable, names the exact artifact + member
  fix?: string;        // machine hint, e.g. 'create dataset "expense" with measure "amount"'
}
```

`issues[]` is carried (a) in every authoring tool's result envelope, (b) in the `verify_build` tool result, (c) on the build-health card in chat, (d) in `ai_eval_runs` rows.

### L1 — Graph lint at draft time (cloud `service-ai-studio`, deterministic)

After `apply_blueprint` / `create_metadata` stage their drafts and **before** the envelope returns, resolve every cross-artifact reference over the *draft-overlaid* registry (`previewDrafts` reads):

- `widget.dataset` exists; every `values[]` name ∈ dataset measures; every `dimensions[]` name ∈ dataset dimensions;
- `view.objectName`/`object` exists; `fields[]` ⊆ object fields; kanban `groupField` exists and is a select;
- `app` navigation targets (object/dashboard/view) all exist;
- `seed.object` exists; record keys ⊆ object fields; lookup/external-id references resolvable within the staged set;
- `dataset.object` exists; measure/dimension `field`s exist on it.

Violations return as `issues[]` **in the same tool result**, so the agent sees them in the turn that caused them and fixes before the user ever could. Incidents #1 and #2 die here.

### L2 — Renderability check, pre-publish (framework + objectui contract)

"Will this artifact mount, or red-box?" is decidable without a browser because both halves are deterministic:

- the **view → component schema** translation and the **component registry** (the `'list'`→typeless-schema bug was exactly this contract breaking) — export the translation as a pure function and ship the registry's type list as data, so the check runs server-side;
- **dataset compilation** (`compileDataset`) — compile every drafted dataset; compile errors are issues;
- dashboards: every widget translates to a registered type with a satisfiable query shape.

Incident #6 dies here. (The renderer keeps its own ErrorBoundary fallbacks — defense in depth, not the primary net.)

### L3 — Runtime probes, post-publish (framework mechanisms, generalizing `seedApplied`)

Immediately after an auto-publish, the build pipeline (not the user) exercises the published app:

- **per seeded object**: row count > 0 (else issue `seed_not_applied`, carrying the existing `seedApplied` error detail);
- **per dashboard widget**: execute its real dataset selection once (the same `/analytics/dataset/query` path users hit); empty-on-populated-object or error → issue `empty_query` with the compiled SQL/strategy detail;
- **per view**: a `limit 1` list read through the same governed path.

Incidents #3, #4, #5 die here — they were all invisible until something *actually queried*. Probe results attach to the publish response (like `seedApplied` today) and flow into the same `issues[]` stream.

### L4 — Self-correction protocol (cloud, the loop itself)

- A `verify_build` tool (cloud service-ai-studio) runs L1+L2 on demand and L3 when the build is published; the system prompt instructs the agent: **after building, verify; if issues, fix and verify again** — at most N rounds (default 2), then stop and report honestly.
- The **auto-publish gate becomes machine-conditional**: publish fires only when L1+L2 are clean. A failing build stays draft, the agent attempts repair; if still failing, the chat shows the health card with remaining issues and a Review affordance. *No silent broken publishes, no waiting on a human either.*
- An **intent review** (cloud intelligence, cheap model): after mechanical verification passes, one LLM pass judges the built app against the user's original goal — nav coherent, labels sensible, fields match the domain, dashboards answer the asked questions. Output: `intent` issues (warnings, non-blocking by default). This is the "AI reviews itself" half that no deterministic check covers.
- The chat renders one **build-health card**: ✓ structure, ✓ renders, ✓ 12 rows, ✓ 3/3 widgets return data, ⚠ warnings — replacing both the silent success and the human-review plea.

### L5 — Agent CI: the golden-prompt eval suite (cloud, uses the existing skeleton)

- `ai_eval_cases`: golden prompts ("build an expense tracker with a spending dashboard", "build a recruiting app", …) each with machine-checkable assertions: app exists; objects/views/dashboards present; row counts > 0; every widget query returns rows; zero render-error boxes (headless DOM sweep — the same browser automation + `mint-session.mjs` used to find this week's bugs).
- Runs headlessly against an **ephemeral environment** per cloud deploy (and nightly), recording to `ai_eval_runs`. A red run blocks nothing initially (report-only), then graduates to a deploy gate once stable.
- Every production incident becomes a new eval case — the suite is the immune system's memory: none of this week's six defects can recur silently once encoded.

### Sequencing

| Phase | Scope | Effort |
|---|---|---|
| 1 | L1 graph lint + envelope `issues[]` + L4 wiring (verify-fix-reverify, gate-on-clean) | ~1 week, cloud |
| 2 | L3 runtime probes + build-health card in chat | ~3–4 days, framework + objectui |
| 3 | L2 renderability contract | ~3–5 days, framework + objectui |
| 4 | L5 eval suite on `ai_eval_*` + intent review | ~1 week, cloud |

Each phase is independently shippable; Phase 1 alone converts this week's discovery latency from *human-hours* to *same-turn*.

## Non-goals

- **Not** removing HITL for destructive/irreversible actions — ADR-0033's pending-action approvals remain; that is safety, not quality review.
- **Not** a general-purpose test runner for user code — the BVL verifies *agent-authored metadata and its runtime behavior*, nothing else.
- **Not** a replacement for deterministic normalization — "make the mistake impossible" stays the first resort; the BVL catches what normalization hasn't met yet.

## Risks

| Risk | Mitigation |
|---|---|
| Verification latency inflates the magic moment | L1/L2 are in-memory and sub-second; L3 runs post-publish in parallel with the user exploring; probes are `limit 1`/single-aggregate |
| Self-correction loops forever | bounded rounds (2), then honest surface |
| Probes mutate state | all probes are reads; seeds are upserts keyed on externalId (idempotent) |
| Eval env drift vs prod | eval runs on the same image staging runs; ephemeral env per run |
| LLM intent-review cost | cheap model, single pass, warnings-only |
