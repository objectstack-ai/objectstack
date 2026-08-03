# ADR-0078: A Zod-valid metadata instance that is functionally incomplete must fail loudly at author time, uniformly across surfaces (the completeness gate)

**Status**: Accepted — framework implemented; the cloud half of §2/§3 pending (cloud) (proposed 2026-06-28 · calibrated 2026-08-03). The core mechanism this ADR was written to build **exists and runs**: the shared per-type predicate is `packages/spec/src/kernel/functional-completeness.ts`, the author-time gate is `packages/lint/src/validate-functional-completeness.ts` (registered `gating` in `authoring-rules.ts`, so `os build` / `os validate` / `os lint` enforce it), and the registration-time twin is in `packages/objectql/src/registry.ts`. Landed as Phase 1 (#4547), Phase 3 (#4565), Phase 4 (#4599) and the framework half of Phase 2 (#4577); tracked by #4544, calibrated by #4787. **Not** everything is done — §2's graph-lint re-homing and §3's cloud materialization fix are cloud-owned and unverified from this repo, and two Tier-B candidates are deliberately unshipped. Per-phase detail in [Phasing](#phasing). This supersedes the 2026-07-16 audit reading, which predates every PR above.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove gate — *property* level), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (prove-it-runs gate — *integration* level), [ADR-0038](./0038-build-verification-loop.md) (build → verify → self-correct), [ADR-0032](./0032-unified-expression-layer.md) (validate-by-default, no silent failure), [ADR-0072](./0072-reference-scope-and-resolvability.md) (reference resolvability — the reference-side sibling of completeness)
**Sibling**: [ADR-0077](./0077-authoring-surface-boundary-hook-flow-validation.md) — 0077 makes *surface-selection* traps loud (a before-flow can't veto); this ADR makes *instance-completeness* traps loud (a bare summary computes nothing). Same "loud-not-silent, AI-is-the-author" family; orthogonal axis.
**Consumers**: `@objectstack/spec` (per-type completeness predicates, sibling of `aggregation-policy.ts`'s `isIncoherentAggregate`; the liveness ledger), `@objectstack/lint` (the new `validate-functional-completeness` validator run by `os build`/`os validate`/`os lint`), `@objectstack/cloud` `service-ai-studio` (graph-lint reuses the shared predicate; the authoring-path config-drop fix), `@objectstack/objectql` + `@objectstack/plugin-webhooks` (registration-time diagnostic — shipped, no longer optional), the `objectstack-data`/`objectstack-ui`/`objectstack-automation` skills.
**Surfaced by**: [cloud#687](https://github.com/objectstack-ai/cloud/pull/687) (an AI-built `summary` field shipped as a dead `{type:'summary'}` shell; the dependent "occupancy rate" was forever 0 while the agent reported it done) and the follow-on functional-completeness audit (`docs/audits/2026-06-metadata-functional-completeness.md`).

---

## TL;DR

The platform already guards the AI-authored surface with three gates: **(1)** authoring-validity lint (`os build` / cloud graph-lint) — *is the metadata valid?*; **(2)** the liveness ledger (ADR-0049) — *does any code read this property?*; **(3)** prove-it-runs (ADR-0054) — *does a correctly-authored instance run correctly?*

There is a hole **between** them. A metadata **instance** can be Zod-valid (gate 1 passes), every property it uses can be *live* (gate 2 green), and a *correctly*-authored instance can be proven to run (gate 3) — yet **this** instance is dead because it omits a sibling config its consumer needs, and the consumer **silently no-ops** instead of erroring. A `summary` with no `summaryOperations`; an `action` with no `locations`; a `lookup` with no `reference`; a `calendar` view with no date field. Each parses, "renders", reports success — and does nothing.

Two facts make this a decision, not a one-off bug:

1. **The cost is asymmetric for an AI author.** A human sees the field render `0` and digs in; an AI gets a success envelope and reports *done*. Inert-but-valid is *worse than a hard error* — it manufactures false completion (the same asymmetry ADR-0049 named for security, ADR-0054 for integration), here at the instance level.
2. **What coverage exists is path-dependent.** Instance-completeness checks live **only in the cloud AI-build graph-lint**; the framework's `@objectstack/lint` does expressions/widgets/SDUI but **no field/view/action completeness** (`formula_without_expression` exists *only* in cloud). So `os build`, `os validate`, MCP agents, and hand authors get **none** of it. As authoring fans out across surfaces, a per-surface check means every surface re-learns the same dead-instance bug.

**Decision.** Add the **completeness gate**: a Zod-valid instance whose omitted config makes it silently inert must be **(a)** caught by a completeness lint, **(b)** marked `[EXPERIMENTAL — not enforced]`, or **(c)** genuinely-optional-with-graceful-degradation. The fourth state — *parsed, unmarked, silently inert* — is prohibited (the ADR-0049 trichotomy, extended from properties to instances). The check is a **single shared predicate** consumed by **every** authoring surface, not a cloud-only rule. Applied as a **ratchet** (ADR-0054 idiom): the audit's verified high-value shapes now; the long tail gated on a verification pass, not a date.

---

## Context

ADR-0077 (filed the same day) found that the most dangerous authoring failures are **silent**, and that "AI as the primary author + a silent failure mode" is the worst combination. It closed one such trap (surface routing). This ADR closes the adjacent one (instance completeness), found by the same kind of investigation.

The three existing gates and the seam this falls through:

| Gate | Question | Why it misses a bare summary |
|---|---|---|
| **1. Authoring-validity lint** (ADR-0038; `os build`, cloud graph-lint) | Is the metadata valid? | `{type:'summary'}` **is** valid — `summaryOperations` is `.optional()`. Coverage for "valid but inert" is incomplete and lives only on the cloud path. |
| **2. Liveness ledger** (ADR-0049) | Does any code read property P? | `summaryOperations` **is** live; the ledger is per-*property*, blind to a per-*instance* omission. |
| **3. Prove-it-runs** (ADR-0054) | Does a *correct* instance run? | The dogfood proof authors a *complete* summary and asserts it computes; it never asserts an *incomplete* one is rejected. |

The audit (`docs/audits/2026-06-metadata-functional-completeness.md`) catalogs the inert-shape class: confirmed high-value cases (authoring-path config-drop, action-without-locations, relationship-without-reference, date-view-without-date-field), a Tier-B set pending verification, and a Tier-C by-design tail. It also records a discipline result: the audit's scariest candidate — a "sharing rule fails open and shares every record" — **collapsed on a three-file read** (`condition` is required; `ExpressionInputSchema` rejects empty; the match-all branch is gated, per ADR-0049). The audit yields *candidates, not bugs*; each becomes a rule only after verification.

## Decision

### 1. The completeness invariant (extends ADR-0049 from property to instance)

For a metadata type, a config whose **omission makes an otherwise-valid instance silently do nothing** must be in exactly one of:

1. **Completeness-enforced** — a lint flags the omission at author time (`error` if the instance is fully inert, `warning` if it degrades). 
2. **`[EXPERIMENTAL — not enforced]`** — the config (or whole type, e.g. `vector` semantic search) is documented as a known no-op, so authoring it is not a false promise.
3. **Genuinely optional** — omitting it degrades *gracefully* to a working default (e.g. a list view auto-derives columns). Not inert; nothing to enforce.

*Parsed, unmarked, silently inert* is prohibited — the completeness gate.

### 2. One shared predicate, every surface (kills the asymmetry — the core decision)

The check is authored **once** as a pure per-type predicate in `@objectstack/spec`, a sibling of `data/aggregation-policy.ts`'s `isIncoherentAggregate` (the ADR-0019 shared-predicate pattern that already lets `os validate` and cloud graph-lint agree on aggregate coherence):

- **`@objectstack/lint`** gains `validate-functional-completeness.ts` (sibling of `validate-widget-bindings.ts`) consuming the predicate → `os build` / `os validate` / `os lint` / MCP / hand-authoring are covered. — ✅ **Shipped** (#4547). The rule is registered `tier: 'gating'`, `input: 'normalized'`, `commands: ALL` in `packages/lint/src/authoring-rules.ts`, so an error-severity finding fails all three commands, and it reads the pre-parse tier so its findings survive an unrelated schema error elsewhere in the stack.
- **Cloud `service-ai-studio` graph-lint** imports the **same** predicate (as it already imports `isIncoherentAggregate`) instead of keeping a divergent copy → the AI-build path stays covered, in lockstep with the framework. — ⬜ **Open, cloud-owned.** The framework exports the predicate for exactly this (`@objectstack/spec/kernel`), but nothing in this repo can prove cloud consumes it; until it does, the AI-build path keeps a divergent copy and the half of §2 that kills the *drift* (not just the asymmetry) is unrealized. This is the one open item that can silently rot: a rule added here does not reach the cloud path on its own.

Graph-only checks that need the cross-artifact graph (a summary's child-FK resolvability, a formula's dependency on a broken sibling) **stay** in cloud graph-lint — only the pure per-instance core is shared. The ledger (`packages/spec/liveness/`) may annotate which properties participate in a completeness contract.

### 3. Materialization must not strip what the author wrote (the cloud root cause)

The bare summary was not (only) a model mistake: `objectBody`/`editBuildFieldDef` reconstruct a field from an **allow-list** of keys and silently drop the rest, and `BlueprintFieldSchema` cannot even **represent** `summaryOperations`/`expression`/`defaultValue`/typed-field config. A correct authoring is stripped before it is written. Therefore:

- field-building paths **spread-with-denylist**, not allow-list (drop only known-internal keys; preserve unknown functional config — the `create_metadata` path already does this);
- the blueprint field shape **represents** the type-specific config (or the type-specific step is explicitly a documented post-blueprint `update_metadata`, like the approval-flow follow-up), never a silent drop;
- granular tool `type` enums = the real `FieldType` (no silently narrowing `summary`/`master_detail`/`currency`/`percent` out of existence).

This is cloud-side and back-compat-free; it is the single highest-leverage fix (one change revives a swath of field types at once).

**Landing note (2026-08-03).** The **framework half** shipped in #4577: `BlueprintFieldSchema` now has an `expression` slot, and a test pins that the lenient schema and the OpenAI-strict mirror carry **exactly the same keys** — the drift that dropped `formula` when `summaryOperations` was added can no longer happen silently. The **cloud half** (spread-with-denylist in `objectBody`/`editBuildFieldDef`, the remaining blueprint slots, real `FieldType` enums on the granular tools) is cloud-owned; it is *not* verifiable from this repo, so nothing here should be read as asserting it landed.

### 4. Loud-not-silent at the runtime seam (optional, ratcheted)

Where the runtime *skips* an inert instance (`buildSummaryIndex`'s `continue`, a trigger that fails to bind), it emits a **dev-mode diagnostic** at registration rather than swallowing it silently. This is the only layer that is **authoring-tool-agnostic** — it catches an inert instance regardless of which surface (including ones we haven't built) produced it, and complements ADR-0054's prove-it-runs. **No hard Zod `.refine()`** that rejects existing metadata at registration (back-compat); strictness lives in lint/diagnostic, which is observable and non-breaking.

**Landing note (2026-08-03).** ✅ **Built** in Phase 4 (#4599) — this stopped being "optional". The diagnostic sits on `SchemaRegistry.registerObject`, the choke point *every* metadata door converges on (declared stacks, plugin objects, `extend` contributions, `saveMetaItem`, raw `registerObject` calls), because the author-time gate only protects metadata that actually passes through `os build`/`validate`/`lint` — and #3896 (Setup inserting `sys_sharing_rule` rows directly) plus cloud's `rowColor.mapping` (`as never` past tsc) prove the other doors are real, not hypothetical. It runs the **same** `checkFieldCompleteness` and emits the **same rule ids** the lint reports, one aggregated line per object, deduped per object. It **warns and never throws**: §1's `error` severity means *this instance is dead*, not *the system is dead*, and an inert field must not kill a boot thousands of healthy objects share. `plugin-webhooks`' `auto-enqueuer.ts` skip warns with `webhook/without-triggers` for the same reason. `view/layout-without-binding` stays author-time-only — views do not register through this choke point.

### 5. Ratchet, not retrofit

v1 = the shared predicate + the audit's **verified Tier-A** shapes (authoring config-drop, action-locations, relationship-reference, date-view binding) + cloud#687's already-shipped summary/formula rules re-homed onto the predicate. Tier-B shapes land **each behind a verification pass** (the sharing-rule lesson). The long tail is deferred, **gated on proven need** — never a one-shot demand to make all ~60 candidates lints. A **generative** completeness pass was part of this deferral when the ADR was written; Phase 4 **rejected** it outright rather than deferring it further — see §6 and Non-goals.

### 6. A rule ships only with the runtime line that makes it true

*(Added at calibration, 2026-08-03. Not a new decision so much as the one the implementation proved it could not proceed without — recorded here because it is the rule that governs every future addition to the predicate.)*

Each entry in the shared predicate names the **exact runtime site that silently skips the instance**, in the module doc and in the finding's own message — `engine.ts`'s `if (!d.summaryOperations) continue`, `$expand`'s `if (!referenceObject) continue`, `record-validator.ts`'s empty-allowed-list branch, `auto-enqueuer.ts`'s `if (triggers.size === 0) … return null`. A candidate without that citation is not a rule; it is a guess with an error message attached.

This is not caution for its own sake. The audit's scariest candidate — a "sharing rule fails open and shares every record" — **collapsed on a three-file read**, and the sibling unknown-key campaign shipped four confidently wrong prescriptions before adopting the same discipline. A false prescription is worse than a missing rule: it tells an AI author to "fix" working metadata, and it burns the gate's credibility, which is the only thing making the gate obeyed.

Two corollaries, both pinned by tests so they cannot be quietly relaxed:

- **A deliberate NON-rule is recorded with the evidence that exempts it.** `multiselect` without `options` is *not* flagged because `record-validator.ts` says, verbatim, `// free-form (tags without options)` — the runtime blesses it as a mode, which is §1 case (3), genuinely optional. `user` relationships (implicit `sys_user` target) and `timeline`/`tree` views (no renderer verification pass yet) are exempt for their own stated reasons. Adding a rule for any of these is a *regression*, and the test suite is where that attempt fails first.
- **A runtime blessing must be corroborated as still reachable.** The webhook skip site's own comment blesses the empty case as "a manual-only webhook" — structurally identical to the `multiselect` exemption, and on that evidence alone the candidate stays unenforced. But `webhook.zod.ts` (#3196) records that the `api` trigger was **removed** because no manual fire path exists, so the blessed mode is unreachable and the rule is `error` after all. A comment states what its author believed; beliefs go stale when a sibling feature is deleted.

## Phasing

Status per phase as of the 2026-08-03 calibration (#4787). A phase is marked ✅ only for the part this repo can actually show; cloud-side work is marked as such rather than assumed.

- **Phase 1** — ✅ **Implemented** (#4547). Land the shared per-type completeness predicate in `@objectstack/spec`; re-home cloud#687's summary/formula rules onto it; add `validate-functional-completeness` to `@objectstack/lint` so `os build`/`os validate` enforce the field-level core (closing the path asymmetry for the shapes already shipped in cloud). Shipped as `packages/spec/src/kernel/functional-completeness.ts` (`checkFieldCompleteness`, `checkViewCompleteness`, and the pinned `FUNCTIONAL_COMPLETENESS_RULES` id list) plus `packages/lint/src/validate-functional-completeness.ts`, registered as author-time rule 29. Rules shipped: `field/summary-without-operations`, `field/formula-without-expression`, `field/relationship-without-reference`, `field/choice-without-options` (error for `select`/`radio`, warning for `checkboxes`), `view/layout-without-binding` (warning; `kanban`/`calendar`/`gantt`). Its first run against a real app found `showcase_field_zoo.f_summary` — a bare roll-up in the object whose whole job is to demonstrate field types.
- **Phase 2** — 🟡 **Framework half implemented (#4577); cloud half open, cloud-owned.** The cloud authoring-path config-drop fix (§3) — spread-not-allow-list, blueprint field-shape slots, real `FieldType` enums — with the matrix of dropped keys from the audit. Landed here: the `BlueprintFieldSchema.expression` slot and the strict/lenient key-parity pin. Not verifiable here: the `objectBody`/`editBuildFieldDef` allow-list rewrite and the granular-tool enums, which live in the `cloud` repo.
- **Phase 3** — ✅ **Implemented as far as verification supports** (#4565). Verify-then-enforce the Tier-A remainder (action-locations, relationship-reference, date-view binding) and the Tier-B set, one verified shape at a time, across both `@objectstack/lint` and graph-lint. Outcome: `webhook/without-triggers` shipped (error, both `triggers: []` and an omitted key); action-`locations` and approval-approvers were found **already shipped** as their own validators (`validate-action-locations.ts`, `validate-approval-approvers.ts`, the former already exempting the documented headless `locations: []`); relationship-reference, date-view binding and choice-options shipped in Phase 1; nav targets of type page/report/url/component/action turned out to be **reference resolvability (ADR-0072), not completeness** and landed in that module instead (#4574). Deliberately **not shipped, unverified**: `dataset` with zero measures (no runtime consumer in this repo — the dataset compiler lives elsewhere) and schedule-trigger cron validity (`normalizeSchedule` accepts any non-empty string; the scheduler's behaviour on an invalid one was never traced). Three further Tier-B entries (write-side referential integrity, `unique: true` on the memory driver, composite/repeater sub-field constraints) are **runtime/driver gaps with no metadata omission to detect** — not authoring-lint items at all. The graph-lint half of this phase remains open with §2's re-homing.
- **Phase 4** — ✅ **Decided and half built** (#4599); the deferral was resolved, not extended. The two halves got **opposite** verdicts:
  - *Registration-time diagnostics (§4)* — **built now**, because the evidence was already in hand rather than pending (see §4's landing note).
  - *A generative completeness pass* (compose with ADR-0054's `@objectstack/verify` `deriveCrudCases`) — **rejected, not deferred.** A generator can enumerate candidates ("which optional keys might be load-bearing?") but cannot verify runtime skip sites, and by §6 a rule without its skip-site citation is a false prescription. The route is structurally wrong, not early; no amount of accumulated data fixes it. Recorded here so it is not re-proposed as "we finally have enough data".

## Consequences

- **Positive.** Closes the gate-1 instance-completeness hole and the path asymmetry: one predicate, enforced on every authoring surface, so a hand/CLI/MCP author gets the same protection the cloud build agent does. Silent inertness becomes a *loud, self-correctable* error (ADR-0038 loop) instead of a false "done". The three gates compose into an honest chain — *valid* → *complete* → *has a live consumer* → *runs correctly*. §3 makes a correct authoring un-strippable.
- **Negative / cost.** A shared predicate plus dual wiring is more than a cloud-only rule; mitigated by reusing the `isIncoherentAggregate` pattern and the existing `@objectstack/lint` harness. The audit is a candidate list — each rule costs a verification pass before it ships (deliberately; see the sharing-rule reversal). Cloud `.objectstack-sha` must bump when graph-lint re-homes onto the shared predicate.
- **Follow-up.** (1) ✅ Define the authoritative Tier-A predicate set — done; it is `FUNCTIONAL_COMPLETENESS_RULES` in `functional-completeness.ts`, pinned by tests so ids cannot drift. (2) ✅ cloud#687 is the first instance — its rules re-homed onto the shared predicate in Phase 1. (3) ✅ Each Tier-B shape files its verification note before becoming a rule — the discipline is now §6, and two Tier-B candidates were left unshipped under it rather than written on the audit's stated confidence. (4) ⬜ **Open:** cloud graph-lint still has to consume the shared predicate (§2), and the cloud half of §3 (see Phasing) is unlanded here. Until (4) closes, "one predicate, every surface" is true of the framework surfaces only.

## Non-goals

- **Hard Zod refinement that rejects existing metadata.** Strictness is lint + diagnostic (observable, non-breaking), not a registration-time crash — existing apps with benign-incomplete instances must keep loading.
- **Linting all ~60 audit candidates now.** The ratchet targets verified, high-AI-likelihood, fully-inert shapes; the by-design/perf tail (precision/scale, warn-only fail-open predicates) and roadmapped types (`vector`) are marked `experimental`, not enforced.
- **A generative rule sweep.** *Rejected* in Phase 4, not deferred: generation cannot produce the one thing §6 requires of a rule — the runtime line that makes it true. Enumerating candidates is not the bottleneck; verifying them is, and that is the step a generator structurally skips.
- **Re-litigating surface routing.** Which surface a behavior belongs to is ADR-0077; this ADR assumes the instance is on the right surface and asks only whether it is complete enough to run.
- **Replacing prove-it-runs (ADR-0054).** Completeness is an *author-time* gate over *static* structure; it does not assert integration correctness. A complete instance can still run wrong — that is gate 3's job. They compose.
