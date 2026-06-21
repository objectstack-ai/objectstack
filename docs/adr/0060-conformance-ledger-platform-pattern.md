# ADR-0060: Conformance Ledger as a Platform Pattern

**Status**: Proposed (2026-06-21)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: ADR-0049 (enforce-or-remove / no unenforced declaration), ADR-0054
(runtime proof per enforced high-risk primitive), ADR-0056 D10 (Authorization
Conformance Matrix), ADR-0058 D7 (Expression Surface Conformance ledger), ADR-0020
(state-machine converge-and-enforce)
**Consumers**: verify, dogfood, spec, plugin-security, plugin-sharing, objectql, CI
**References**: #1887 (declared-but-unwired sharing condition — the canonical failure)

## TL;DR

The platform has now hand-written the **same conformance ledger twice** — the
ADR-0056 D10 Authorization Conformance Matrix and the ADR-0058 D7 Expression
Surface ledger — to defend against the **declared-but-unenforced** failure class:
a property that *looks* authorable but the runtime never wires, so it silently
does nothing (#1887: a sharing `condition` the interpreter understands but no
compiler lowered). Two instances with near-identical shape (`id` / `state` /
`enforcement-site` / `proof` + a CI test that asserts completeness and that every
proof exists) is the signal to **promote the ledger from a habit to a platform
pattern**: one reusable ledger model + CI helper, the two existing instances
refactored onto it, and a third instance for the **object validation-rule surface**
(which now includes the ADR-0020-enforced `state_machine`). A declaration surface
is **"landed" iff it has a conformance ledger whose CI ratchet is green** — no
ledger, not landed.

## Context

### The recurring failure: declared-but-unenforced

ObjectStack is metadata-driven and increasingly **AI-authored**. Its defining
risk is not a crash — it is a primitive that is *declarable* but *inert*:

- **#1887** — `SharingRuleSchema.condition` (CEL) was authorable and type-checked,
  but no compiler lowered it; authoring a rule granted nothing. Silent.
- **ADR-0020 (pre)** — `state_machine` existed as three declaration shapes and
  **zero** runtime enforcement; a Flow could drive `status` straight to `closed`.
- **ADR-0049** catalogues a long tail of `[EXPERIMENTAL — not enforced]` bits
  (transfer/restore/purge, masking, policy, …) that read as features but enforce
  nothing.

AI authorship **amplifies** this class: an LLM is excellent at producing
configuration that *looks* complete and terrible at noticing that nothing reads
it. The defence that works is not "review harder" — it is a **machine-checked
ledger** that, for every declarable property, forces the answer to "where is this
enforced, and what proves it?", and **breaks the build** when a new property
appears with no answer.

### Two hand-written ledgers, one shape

- **ADR-0056 D10** — `authz-conformance.matrix.ts`: `{ id, summary, state, enforcement?, proof?, note? }` + `authz-conformance.test.ts` asserting valid state, enforced-has-site, proof-file-exists.
- **ADR-0058 D7** — `expression-conformance.ledger.ts`: the same core plus `{ dialect, mode, failPolicy, covers[] }` and a **ratchet** that re-discovers every `ExpressionInputSchema` field in `packages/spec/src` and fails if any is unclassified.

They share a model and a test discipline; they were written twice. The second
one's **ratchet** (discover the real surface from source, assert the ledger
covers it) is the strictly stronger pattern and the one worth standardizing.

## Decision

Governing rules: ADR-0049 (a declaration is enforced / experimental / removed —
never a silent fourth state), ADR-0054 (each enforced high-risk primitive carries
a runtime proof).

### D1 — One reusable ledger model + CI helper

Define a single conformance model and an `assertLedger` helper:

    interface ConformanceRow {
      id: string;
      summary: string;
      surface?: string;                         // the declaration site this row classifies
      state: 'enforced' | 'experimental' | 'removed';
      enforcement?: string;                     // runtime site — REQUIRED when enforced
      proof?: string;                           // repo-root-relative; file must exist
      covers?: string[];                        // ratchet keys this row accounts for
      note?: string;                            // REQUIRED when experimental/removed
      meta?: Record<string, unknown>;           // per-surface extras (dialect, mode, failPolicy, …)
    }

    assertLedger(rows, {
      proofRoot,                                // resolve `proof` against this
      discover?: () => Set<string>,             // optional: the real surface, from source
      highRisk?: string[],                      // ids that MUST carry a proof
    })

`assertLedger` encodes the shared invariants once: unique ids, valid state,
enforced-has-enforcement, experimental/removed-has-note, every `proof` exists,
each surface covered by exactly one row, and — when `discover` is supplied — the
**ratchet**: every discovered surface is `covers`-ed (else "classify it") and no
`covers` is stale. Per-surface extras (dialect/mode/fail-policy) live in `meta`,
so the model is universal without losing the richer expression-surface fields.

### D2 — Refactor the two existing ledgers onto the model

`authz-conformance` and `expression-conformance` keep their data and their
domain-specific `discover`/`highRisk`, but delegate all structural assertions to
`assertLedger`. This deletes the duplicated test logic and proves the model is
genuinely shared (not a third bespoke shape).

### D3 — Third instance: the object validation-rule surface

Add a `validation-conformance` ledger over the `validations` union
(`state_machine`, `cross_field`, `script`, `format`, `json_schema`, `conditional`,
`unique`, `required`, …) with a `discover` that enumerates the rule `type`
literals from `packages/spec/src/data/validation.zod.ts`. Each rule type is
classified with its enforcement site and (for enforced) a proof. This **pins the
ADR-0020 `state_machine` enforcement** (and the now-unblocked `cross_field` /
`script`) into CI, and makes "a new validation rule type with no enforcement" —
the exact pre-ADR-0020 `state_machine` disease — a build break.

### D4 — Home the helper in `@objectstack/verify`

The reusable model + `assertLedger` live in `@objectstack/verify` (a small
`conformance` submodule). `verify` already owns "prove the app actually behaves"
via its runtime harness; the static conformance ledger is its **compile-time
complement** — both answer "is this primitive real?", one by booting, one by
ledger. The per-surface ledgers + their `discover` functions stay where their
proofs live (dogfood), importing the helper.

### D5 — "Landed" is defined by the ledger

A declaration surface is **landed iff it has a conformance ledger whose ratchet
is green**. This becomes the platform's definition of done for any new authorable
surface: you do not get to add an `ExpressionInputSchema`-style declaration family
without a ledger row + (if enforced) a proof. ADR-0049's "enforce or remove" gains
a third, mechanical leg: **ledger or it isn't landed.**

### D6 — A single CI aggregate (optional, P3)

A meta-test can import every registered ledger and assert each passes
`assertLedger`, so "the conformance surface is whole" is one green check. Until
then, each ledger's own test is the gate (as today).

## Consequences

Positive: the declared-but-unenforced defence becomes a **reusable platform
capability** rather than copy-paste; adding a new declaration surface is "fill in
a ledger", not "re-derive the discipline"; the ADR-0020 state-machine enforcement
stops being implicit and becomes a CI-pinned, proof-backed row; AI authorship gets
a uniform, machine-checked guardrail across surfaces.

Negative / cost: refactoring the two existing ledgers carries migration risk
(mitigated — same data, only the assertion layer moves, tests stay green);
`@objectstack/verify` gains a static-analysis responsibility alongside its runtime
one (kept in a separate submodule so the boot harness is untouched).

Neutral / open: which additional surfaces get a ledger next (flows, UI actions,
connectors) is evidence-gated, not mandated here — D5 sets the rule, P3 applies it
where the declared-but-unenforced risk is highest.

## Non-goals

Not a change to any **runtime** semantics — purely the conformance/verification
layer. Not a replacement for the `@objectstack/verify` runtime harness (it is the
static complement). Not a mandate that every surface acquire a ledger immediately
— D5 is the standard going forward; existing surfaces migrate as P3 reaches them.

## Alternatives considered

(a) **Keep hand-writing each ledger** — rejected: every new surface re-pays the
discipline and drifts (the two existing ones already diverged in richness).
(b) **One giant global ledger** for the whole platform — rejected: couples
unrelated surfaces, loses the per-surface `discover` that makes the ratchet sharp.
(c, chosen) **One reusable model + helper, one ledger instance per surface** —
shared invariants, independent ratchets, additive.

## Phasing

- **P1** — D1 model + `assertLedger` in `@objectstack/verify`; D2 refactor the
  authz + expression ledgers onto it (tests stay green; proves reuse).
- **P2** — D3 validation-rule-surface ledger + ratchet; classify every rule type,
  pin the ADR-0020 `state_machine` enforcement with a proof.
- **P3** — D5 as the documented "landed" bar; D6 CI aggregate; extend to the next
  highest-risk surfaces (flow conditions, UI actions, connectors) as evidence warrants.

## References

ADRs 0020, 0049, 0054, 0056 (D10), 0058 (D7). Issue #1887. Existing instances:
`packages/dogfood/test/authz-conformance.{matrix,test}.ts`,
`packages/dogfood/test/expression-conformance.{ledger,test}.ts`. Helper home:
`packages/verify/`. Target surface: `packages/spec/src/data/validation.zod.ts`.
