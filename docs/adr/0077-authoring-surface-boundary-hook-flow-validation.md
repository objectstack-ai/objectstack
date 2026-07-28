# ADR-0077: The authoring-surface boundary — route by intent, not mechanism; verifiability tier = friction tier; loud-not-silent; code is the flagged escape hatch

**Status**: Proposed (2026-06-28)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0010](./0010-nl-to-flow-authoring.md) (NL→flow; flow is the AI-authored IR), [ADR-0018](./0018-unified-node-action-registry.md) (one open node/action registry), [ADR-0019](./0019-approval-as-flow-node.md) (collapse approval into flow — one engine, durable-pause node), [ADR-0031](./0031-advanced-flow-node-executors-and-dag.md) (structured control-flow, well-formed-by-construction), [ADR-0032](./0032-unified-expression-layer.md) (validate-by-default, **no silent failure**), [ADR-0034](./0034-transactional-writes-and-ambient-transaction.md) (ambient transaction; the ALS boundary), [ADR-0038](./0038-build-verification-loop.md) (the agent builds → verifies → self-corrects), [ADR-0041](./0041-flow-trigger-family.md) (flow trigger family), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove gate), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (prove-it-runs gate), [ADR-0058](./0058-expression-and-predicate-surface.md) (one expression language, two backends), [ADR-0073](./0073-automation-execution-identity.md) (`runAs` is authorization posture)
**Consumers**: `@objectstack/spec` (`HookSchema`, `FlowSchema`, validation-rule schema — the intent metadata each surface carries), `@objectstack/cli` (`os build` lints — the new loud-not-silent guardrails), `@objectstack/objectql` (hook binder / wrappers), `@objectstack/service-automation` (flow engine + `trigger-record-change`), the `objectstack-automation` and `objectstack-data` skills (the routing decision tree the build agent follows)

**Premise**: pre-launch — pin the boundary before the AI authors a large body of automation against an ambiguous one. This ADR is **mostly a decision record plus two author-time guardrails**. It changes almost no runtime; it changes which surface the AI is *steered to* and makes the surfaces' real limits *audible at build time* instead of silent at runtime.

> **Trigger**: a design review of "is hook metadata still necessary now that flow is this capable, and when should each be used?" The investigation found that hook, flow, and validation rule **overlap on the verbs** (all can `beforeInsert`/`afterUpdate`, all can run CEL/JS, all can write other records) but **diverge on guarantees** — and the most dangerous divergence is **silent**: a flow bound to `record-before-*` that expects to rewrite or veto the triggering write does neither, with no error (see Context). With AI as the primary author, an ambiguous boundary plus a silent failure mode is the worst combination: the model picks a plausible-but-wrong surface and nothing catches it.

---

## TL;DR

1. **[model] Route by *intent*, not by *mechanism*.** The author (human or AI) declares **what they want to happen**; the platform maps that intent to the **narrowest surface that can express it correctly**. The decision is not "hook vs flow" — it is:
   - *"Reject a write when a condition holds"* → **validation rule** (declarative veto, in-transaction).
   - *"Derive / normalize a field as it is written"* → **formula field** (if pure) or a **hook** (if it needs a lookup).
   - *"When X happens, perform a sequence of reactions"* → **flow** (visual, observe→react, error-isolated).
   - *"None of the above / performance-critical / complex transactional logic"* → **hook** (code escape hatch).
2. **[model] The three surfaces are tiered by *who they are for*, not by power.** Validation rule and flow are **business-legible** (Studio-rendered, reviewable by a non-engineer, queryable as data). Hook is the **deliberately not-business-facing** tier — data-integrity plumbing the author owns and the business neither needs to read nor may edit. Hook is **not flow's poor cousin**; it is the home for logic that *should not* be visualized.
3. **[model] Verifiability tier = friction tier.** A change's review friction is set by how provable it is *before it ships*: declarative surfaces (validation / formula / flow graph) are schema-validated by `os build` and may flow through review at lower friction; a **hook body is the only surface that is not statically provable**, so it is the one that **always requires a human reviewer** (it is the highest-risk AI artifact — Turing-complete, side-effecting, verifiable only by running).
4. **[ruled] `record-before-*` flows cannot rewrite or veto the triggering write — and the platform must say so loudly.** The `record_change` trigger discards the flow's output and **swallows its errors by design** (error isolation). A flow there is observe→react only. The "visual write-time gate" belongs to **validation rule** (veto) and **hook** (rewrite), never to a before-flow.
5. **[ruled — non-goal] Do not extend `record-change` flow to mutate/veto/join-the-transaction.** That path re-creates the Salesforce *order-of-execution* swamp and hands the AI *more* overlapping ways to express one intent — the opposite of what reduces error. If a visual write-time gate is ever proven necessary, build it as a **constrained validation-rule editor** or a **tightly-bounded before-save subtype** (no suspend, no callout, build-time-enforced), *not* as "flow, but in `before-*`".
6. **[staging] Build almost nothing now.** v1 = **this record + two `os build` lints** that turn today's silent traps into errors (see Decision §4). Everything else — a visual validation-rule editor, a before-save subtype — is deferred and **gated on a proven need**, not a date (ADR-0049 idiom).

---

## Context

### The three surfaces, code-grounded

| Capability | **Validation rule** | **Hook** (`HookSchema`) | **Record-change flow** |
|---|---|---|---|
| Rewrite the in-flight record (`before-*`) | — | ✅ mutate `ctx.input` (in-tx) | ❌ flow output **discarded** |
| Veto the write (rollback) | ✅ declarative | ✅ `throw` / `onError:'abort'` (in-tx) | ❌ errors **swallowed** |
| Same transaction as the triggering write | ✅ (before-write) | ✅ before in-tx / after post-commit | ❌ not by design (see below) |
| Intercept reads (`beforeFind`/`afterFind`/`aggregate`) | — | ✅ | ❌ trigger has no read events |
| Multi-step orchestration, human approval, wait, subflow | — | ❌ single body | ✅ DAG + durable pause |
| Triggered by schedule / webhook / manual | — | ❌ data-lifecycle only | ✅ (ADR-0041) |
| Business-legible (Studio-rendered, reviewable by non-engineer) | ✅ | ❌ (code) | ✅ |
| Statically provable at `os build` time | ✅ schema | ⚠️ schema-of-the-wrapper only; **body is opaque** | ✅ schema + DAG well-formedness |

Sources: `packages/triggers/trigger-record-change/src/record-change-trigger.ts` (the handler runs the flow then **discards its return value**, and wraps it in `try/catch` whose comment reads *"a flow failure must NEVER break the CRUD write that triggered it"*); `packages/spec/src/data/hook.zod.ts` (`HookSchema` — `before-*` mutate `ctx.input`, `throw` to abort; registered as a first-class metadata type in `metadata-type-schemas.ts`); `packages/services/service-automation/src/builtin/crud-nodes.ts` (flow CRUD nodes resolve a fresh data engine via `ctx.getService('data')` and build their own `dataCtx` from `runAs`/session — they **do not thread a transaction handle**).

### Why a before-flow is *not* atomic with its trigger (the precise mechanism)

ObjectQL has an ambient-transaction store (ADR-0034, `AsyncLocalStorage` in `objectql/src/engine.ts`). Within an unbroken async chain on the same engine, internal data ops *inherit* the open transaction. One might therefore hope a before-flow's CRUD nodes join the triggering write's transaction. They do not, for two compounding reasons:

1. **Errors are swallowed before they can roll anything back.** The trigger's `try/catch` is the outermost frame around the flow; a failing flow write never propagates to the transaction boundary, so rollback is structurally impossible — independent of ALS.
2. **The flow path does not thread the transaction explicitly**, and ALS is fragile here: it does **not** survive `setImmediate`/deferred-promise boundaries (the documented sandbox-runner limitation in `engine.ts`, ~L3217). Any atomicity would be *accidental* (inline before-path only) and *untested* — not a guarantee an author may rely on.

The net is a **silent** contract violation: an author who writes a before-flow to normalize a field or block a save gets a flow that runs, changes nothing on the triggering record, cannot stop the write, and reports success. Nothing fails; the wrong thing just quietly happens.

### Why this matters more under AI authoring

AI rarely emits code that does not compile; it emits code that compiles and is *subtly wrong*. The platform's only defenses are (a) shrink the space of expressible-but-wrong constructs, (b) make every real constraint **loud at build time**, and (c) prefer surfaces whose intent is explicit and machine-checkable. All three argue for **declarative-first, code-as-last-resort**, and for **converging** the number of overlapping surfaces — the same lesson mainstream platforms learned the expensive way (Salesforce retired Workflow Rules and Process Builder onto Flow, kept Validation Rules separate, kept Apex for the complex/transactional tail, and still carries a famously intricate order-of-execution as the bill for overlap). A pile of AI-written hook bodies is unanalyzable; a graph of declarative metadata is queryable, diffable, and migratable — so declarative-first is the right bet **especially** as AI scales, consistent with the platform's metadata-as-source-of-truth thesis.

---

## Decision

### 1. Intent → surface routing (the canonical table the build agent follows)

| The author's intent | Surface | Why this one |
|---|---|---|
| Reject a save when a condition holds | **validation rule** | declarative veto, in-transaction, business-legible, statically checkable |
| Compute a field from other fields (pure) | **formula field** | no code; recomputed deterministically |
| Normalize / derive a field on write (needs a lookup or non-pure logic) | **hook** (`before-*`, mutate `ctx.input`) | only the in-tx write path may rewrite the record |
| Enforce a cross-record / transactional invariant that must roll back the write | **hook** (`throw` / `onError:'abort'`) | only hook participates in the triggering transaction |
| Intercept or shape reads | **hook** (`beforeFind`/`afterFind`) | flow triggers have no read events |
| When X happens, run a sequence (notify, call out, create follow-ups, route for approval, wait) | **flow** | multi-step, durable-pause, error-isolated, visual |
| Triggered by schedule / inbound webhook / manual launch | **flow** | the non-data triggers live only on flow (ADR-0041) |
| Genuinely complex / hot-path / batch logic that would become unreadable as a graph | **hook** (escape hatch) | declarative surfaces have a real ceiling; do not force spaghetti graphs |

**The one-line test the AI applies:** *Does this need to rewrite or block this write?* → **validation rule (block)** or **hook (rewrite/transactional)**. *Is it a reaction after the fact?* → **flow**. *Is it integrity plumbing nobody should see in Studio?* → **hook**.

### 2. Tiering by audience (settles the only real overlap)

The genuine overlap is `after-*` side effects (write succeeded → notify / audit / enqueue), which hook and flow can both do. Resolve it by audience, per ADR-0019's "one engine" spirit:

- If operations/business may ever want to **see or change** the logic → **flow**.
- If it is pure developer-owned derivation that no one will open in Studio → **hook** (`async:true`).

### 3. Verifiability tier = friction tier (wired into review, ADR-0038 / ADR-0033 draft-gating)

- Declarative changes (validation rule, formula, flow graph) are **fully schema-validated by `os build`** and carry lower review friction.
- A **hook body is opaque to static proof** → a metadata change that adds or edits a hook **body** is flagged as **requires-human-review**, regardless of who authored it. This is the in-loop way the platform "trains" the AI: the model reacts to a build error or a review gate, never to a silent no-op.

### 4. Loud-not-silent — the two new `os build` lints (the only code in v1)

Authored alongside the existing flow lints in `packages/cli/src/utils/lint-flow-patterns.ts` (which already ships `flow-runas-unscoped`, `flow-double-brace-interpolation`, etc.):

- **`flow-record-before-cannot-mutate`** — *error*. A flow bound to `record-before-*` that contains a `create_record`/`update_record` node targeting the **triggering object/record**, or otherwise reads as expecting to change the in-flight record. Message points to **hook** (rewrite) or **validation rule** (veto).
- **`flow-record-before-cannot-veto`** — *error*. A `record-before-*` flow whose shape implies it intends to stop the write (e.g. a decision branch ending in an error/`end` node presented as rejection). Message: *"record-change flows cannot abort the triggering write — its errors are isolated by design; use a validation rule to reject, or a hook to throw."*
- (Companion, optional) **`flow-record-before-suspends`** — *error*: a `record-before-*` flow containing a suspend-capable node (`approval`/`wait`/`screen`), which cannot hold a write transaction open.

These convert the exact failure mode this ADR is named after from *silent at runtime* to *loud at author time* — the highest-ROI move and a direct application of ADR-0032's no-silent-failure and ADR-0054's prove-it-runs principles to the trigger surface.

### 5. Non-goals (explicit, so a future agent does not "fix" them)

- **Do not** wire flow output write-back into `record-before-*`.
- **Do not** make the trigger propagate flow errors to abort the write.
- **Do not** thread the ambient transaction into flow CRUD nodes for the trigger path.

All three would merge what ADR-0019/0041 deliberately separated, add overlapping ways to express one intent, and pay the order-of-execution cost. If a visual write-time gate is ever proven necessary, the sanctioned path is a **visual editor for validation rules** and/or a **constrained before-save subtype** with its constraints enforced at build time — recorded here as the only acceptable design, deferred until a real consumer exists.

---

## Consequences

- **Hook metadata stays.** It uniquely owns the in-transaction write path (rewrite + veto) and the read path (`beforeFind`/`afterFind`) — neither of which flow can express by construction. Removing it would push data-integrity logic back into hand-coded plugins. The question that triggered this ADR ("is hook still necessary?") is answered: **yes, and the boundary is now named.**
- **The AI has one obvious surface per intent**, with the dangerous wrong choice (before-flow as a write gate) now a build error rather than a silent no-op.
- **Review friction tracks provability**, so the costly human-in-the-loop attention concentrates on the one surface (hook bodies) that actually needs it.
- **Honest ceiling acknowledged.** Declarative is not universal; forcing genuinely complex logic into flow graphs produces unmaintainable spaghetti (a real, documented Flow failure mode). Hook remains the sanctioned escape hatch — isolated, owned, human-reviewed.
- **Follow-ups**: (a) encode the §1 routing table into the `objectstack-automation` and `objectstack-data` skills so the build agent routes by intent; (b) land the §4 lints; (c) add the `after-*` audience rule (§2) to the skills.
