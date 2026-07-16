# ADR-0078: A Zod-valid metadata instance that is functionally incomplete must fail loudly at author time, uniformly across surfaces (the completeness gate)

**Status**: Proposed (2026-06-28) — philosophy adopted piecemeal, core mechanism unbuilt (2026-07-16 audit): the shared per-type completeness predicate in `@objectstack/spec` and the `validate-functional-completeness` lint do NOT exist; only narrow per-shape applications landed (page `source` refine, form-layout/semantic-roles/widget-bindings lints). The principle is however actively cited and enforced case-by-case (e.g. `bootstrapDeclaredPermissions` closed the `stack.permissions` inert-metadata violation, ADR-0086 D5).
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove gate — *property* level), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (prove-it-runs gate — *integration* level), [ADR-0038](./0038-build-verification-loop.md) (build → verify → self-correct), [ADR-0032](./0032-unified-expression-layer.md) (validate-by-default, no silent failure), [ADR-0072](./0072-reference-scope-and-resolvability.md) (reference resolvability — the reference-side sibling of completeness)
**Sibling**: [ADR-0077](./0077-authoring-surface-boundary-hook-flow-validation.md) — 0077 makes *surface-selection* traps loud (a before-flow can't veto); this ADR makes *instance-completeness* traps loud (a bare summary computes nothing). Same "loud-not-silent, AI-is-the-author" family; orthogonal axis.
**Consumers**: `@objectstack/spec` (per-type completeness predicates, sibling of `aggregation-policy.ts`'s `isIncoherentAggregate`; the liveness ledger), `@objectstack/lint` (the new `validate-functional-completeness` validator run by `os build`/`os validate`/`os lint`), `@objectstack/cloud` `service-ai-studio` (graph-lint reuses the shared predicate; the authoring-path config-drop fix), `@objectstack/objectql` (optional registration-time diagnostic), the `objectstack-data`/`objectstack-ui`/`objectstack-automation` skills.
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

- **`@objectstack/lint`** gains `validate-functional-completeness.ts` (sibling of `validate-widget-bindings.ts`) consuming the predicate → `os build` / `os validate` / `os lint` / MCP / hand-authoring are covered.
- **Cloud `service-ai-studio` graph-lint** imports the **same** predicate (as it already imports `isIncoherentAggregate`) instead of keeping a divergent copy → the AI-build path stays covered, in lockstep with the framework.

Graph-only checks that need the cross-artifact graph (a summary's child-FK resolvability, a formula's dependency on a broken sibling) **stay** in cloud graph-lint — only the pure per-instance core is shared. The ledger (`packages/spec/liveness/`) may annotate which properties participate in a completeness contract.

### 3. Materialization must not strip what the author wrote (the cloud root cause)

The bare summary was not (only) a model mistake: `objectBody`/`editBuildFieldDef` reconstruct a field from an **allow-list** of keys and silently drop the rest, and `BlueprintFieldSchema` cannot even **represent** `summaryOperations`/`expression`/`defaultValue`/typed-field config. A correct authoring is stripped before it is written. Therefore:

- field-building paths **spread-with-denylist**, not allow-list (drop only known-internal keys; preserve unknown functional config — the `create_metadata` path already does this);
- the blueprint field shape **represents** the type-specific config (or the type-specific step is explicitly a documented post-blueprint `update_metadata`, like the approval-flow follow-up), never a silent drop;
- granular tool `type` enums = the real `FieldType` (no silently narrowing `summary`/`master_detail`/`currency`/`percent` out of existence).

This is cloud-side and back-compat-free; it is the single highest-leverage fix (one change revives a swath of field types at once).

### 4. Loud-not-silent at the runtime seam (optional, ratcheted)

Where the runtime *skips* an inert instance (`buildSummaryIndex`'s `continue`, a trigger that fails to bind), it emits a **dev-mode diagnostic** at registration rather than swallowing it silently. This is the only layer that is **authoring-tool-agnostic** — it catches an inert instance regardless of which surface (including ones we haven't built) produced it, and complements ADR-0054's prove-it-runs. **No hard Zod `.refine()`** that rejects existing metadata at registration (back-compat); strictness lives in lint/diagnostic, which is observable and non-breaking.

### 5. Ratchet, not retrofit

v1 = the shared predicate + the audit's **verified Tier-A** shapes (authoring config-drop, action-locations, relationship-reference, date-view binding) + cloud#687's already-shipped summary/formula rules re-homed onto the predicate. Tier-B shapes land **each behind a verification pass** (the sharing-rule lesson). The long tail and a generative completeness pass are deferred, **gated on proven need** — never a one-shot demand to make all ~60 candidates lints.

## Phasing

- **Phase 1.** Land the shared per-type completeness predicate in `@objectstack/spec`; re-home cloud#687's summary/formula rules onto it; add `validate-functional-completeness` to `@objectstack/lint` so `os build`/`os validate` enforce the field-level core (closing the path asymmetry for the shapes already shipped in cloud).
- **Phase 2.** The cloud authoring-path config-drop fix (§3) — spread-not-allow-list, blueprint field-shape slots, real `FieldType` enums — with the matrix of dropped keys from the audit.
- **Phase 3.** Verify-then-enforce the Tier-A remainder (action-locations, relationship-reference, date-view binding) and the Tier-B set, one verified shape at a time, across both `@objectstack/lint` and graph-lint.
- **Phase 4 (deferred, evidence-gated).** Registration-time diagnostics (§4) and a generative completeness pass (compose with ADR-0054's `@objectstack/verify` `deriveCrudCases`). Pursued only once the static rules prove out.

## Consequences

- **Positive.** Closes the gate-1 instance-completeness hole and the path asymmetry: one predicate, enforced on every authoring surface, so a hand/CLI/MCP author gets the same protection the cloud build agent does. Silent inertness becomes a *loud, self-correctable* error (ADR-0038 loop) instead of a false "done". The three gates compose into an honest chain — *valid* → *complete* → *has a live consumer* → *runs correctly*. §3 makes a correct authoring un-strippable.
- **Negative / cost.** A shared predicate plus dual wiring is more than a cloud-only rule; mitigated by reusing the `isIncoherentAggregate` pattern and the existing `@objectstack/lint` harness. The audit is a candidate list — each rule costs a verification pass before it ships (deliberately; see the sharing-rule reversal). Cloud `.framework-sha` must bump when graph-lint re-homes onto the shared predicate.
- **Follow-up.** (1) Define the authoritative Tier-A predicate set. (2) cloud#687 is the first instance — its rules re-home onto the shared predicate in Phase 1. (3) Each Tier-B shape files its verification note before becoming a rule.

## Non-goals

- **Hard Zod refinement that rejects existing metadata.** Strictness is lint + diagnostic (observable, non-breaking), not a registration-time crash — existing apps with benign-incomplete instances must keep loading.
- **Linting all ~60 audit candidates now.** The ratchet targets verified, high-AI-likelihood, fully-inert shapes; the by-design/perf tail (precision/scale, warn-only fail-open predicates) and roadmapped types (`vector`) are marked `experimental`, not enforced.
- **Re-litigating surface routing.** Which surface a behavior belongs to is ADR-0077; this ADR assumes the instance is on the right surface and asks only whether it is complete enough to run.
- **Replacing prove-it-runs (ADR-0054).** Completeness is an *author-time* gate over *static* structure; it does not assert integration correctness. A complete instance can still run wrong — that is gate 3's job. They compose.
