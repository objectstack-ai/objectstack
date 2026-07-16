# ADR-0054: A live authorable property must be proven at runtime, not merely have a consumer (prove-it-runs gate)

**Status**: Accepted (2026-06-18)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove gate), [ADR-0005](./0005-metadata-customization-overlay.md) (artifact vs runtime), [ADR-0053](./0053-date-and-datetime-semantics.md) (the domain of the motivating regression)
**Consumers**: `@objectstack/spec` (liveness ledger `packages/spec/liveness/<type>.json`), the Spec Liveness Check CI gate (#1919), `@objectstack/dogfood` (the runtime gate, [#2020](https://github.com/objectstack-ai/framework/pull/2020)), `@objectstack/verify` (the published proof engine + CLI, [#2041](https://github.com/objectstack-ai/framework/pull/2041)), spec authors, platform contributors.
**Surfaced by**: PR [#2018](https://github.com/objectstack-ai/framework/pull/2018) — "organization timezone drives analytics date bucketing" was **green on every static gate** (build, ~900 unit tests, spec-liveness, CodeQL) yet broken end-to-end across three integration seams; and the field-type capability-matrix dogfood ([#2022](https://github.com/objectstack-ai/framework/pull/2022)), which on its first run found `rating`/`slider`/`toggle` reading back wrong-typed.

---

## TL;DR

ObjectStack is a development platform: **third parties have an AI author
arbitrary metadata**, and the promise is that it works at runtime. ADR-0049
closed *false compliance* — a property declared but unenforced. The liveness
ledger (#1919) then made every authorable property declare a status
(**live / experimental / dead**) with evidence, killing silent dead surface.

But "live" today means only **a static `file:line` pointer to a consumer** —
proof that *something reads the property*. That is necessary but **not
sufficient**. A property can be live at every individual layer and still be
**broken end-to-end**, because the break lives in the *integration* — engine ↔
driver ↔ service ↔ HTTP ↔ execution-context. #2018 is the proof: `timezone`,
date bucketing, the analytics strategy, and the REST context were each
individually correct (and individually unit-tested against mocks); the bucket
was wrong only when they ran together. Call this gap **unproven liveness**: the
ledger says "live", the AI is told "you may author this", and it silently
misbehaves at runtime.

A metadata-driven platform whose authors are AI cannot ship unproven liveness
for the primitives that matter. The static pointer must be upgradable to a
**runtime proof** — a [`@objectstack/dogfood`](../../packages/qa/dogfood) test that
authors the property against the real, in-process stack and asserts the runtime
result.

**Decision.** Extend the enforce-or-remove gate (ADR-0049) with a third leg —
**prove-it-runs**. For a defined high-risk class of authorable properties, a
`live` classification must carry a `proof` (a dogfood test reference), not just a
consumer pointer. Applied as a **ratchet, not a retrofit**: required for newly
added/changed high-risk properties and for any property implicated in a shipped
runtime regression — never as a one-shot demand to prove all 200 live properties.

---

## Context

Three gates already guard the authorable surface, each at a different layer:

| Gate | Question it answers | Where it can be fooled |
|---|---|---|
| **AI-authoring guardrails** (build-time lint, broken→error / fragile→warning) | *Is the authored metadata valid?* | Valid ≠ correct at runtime. |
| **Spec liveness ledger** (ADR-0049 + #1919) | *Does any code read this property?* | A consumer existing ≠ the integrated path being correct. |
| **Dogfood gate** ([#2020](https://github.com/objectstack-ai/framework/pull/2020)) | *Does authoring it produce correct runtime behavior?* | Coverage is currently incidental — whatever the example apps happen to exercise. |

The liveness ledger's evidence is a static pointer
(`packages/spec/liveness/<type>.json`, e.g. `field:line`). It is excellent at
killing *dead* surface (parsed, no consumer). It is **blind to integration
correctness**: #2018's properties all had valid consumer pointers and were
classified live, yet the end-to-end result was wrong. The same blindness let
`rating`/`slider`/`toggle` be live (they persist) while reading back as the
wrong JS type — found only when [#2022](https://github.com/objectstack-ai/framework/pull/2022)
wrote one and read it back over the real API.

The cost is asymmetric for *this* platform. When a human authors metadata and it
misbehaves, they notice and adjust. When an **AI** is told a property is live and
emits it across the combinatorial space the examples never cover, the
misbehavior ships silently into a third-party app. "Live" must therefore carry a
stronger guarantee for the primitives an AI is most likely to combine in ways the
curated examples don't.

## Decision

### 1. The contract — `live` may be backed by a runtime proof

The liveness ledger gains an optional, stronger evidence form for `live`
properties: alongside the static consumer pointer, an entry may carry a
**`proof`** — a reference to a `@objectstack/dogfood` test that authors the
property against the real in-process stack and asserts the runtime outcome
(a value, a bucket, a count, a denied write — observable behavior, not "no
error").

A proof supersedes a static pointer: it subsumes "a consumer exists" and adds
"the integrated path is correct."

### 2. The ratchet — required for the high-risk class, on change

A `proof` is **required** (CI-enforced via the liveness gate) only for:

- **(a) High-risk authorable classes, on add/change.** The classes whose values
  cross the engine↔driver↔service↔HTTP boundary and have repeatedly broken in
  *integration* despite green unit tests:
  - field types — persistence + read-coercion fidelity (the field-zoo matrix),
  - analytics dimensions / measures — bucketing, aggregation, timezone,
  - RLS / sharing — read **and** by-id-write enforcement,
  - flow nodes — execution + variable wiring,
  - form layout/section/widget — server-side resolution.
- **(b) Regression carriers.** Any property implicated in a *shipped* runtime
  regression: the fix PR must add (or un-quarantine) its dogfood proof — exactly
  as #2018 added the tz proof, and as the `rating`/`slider`/`toggle` fix must
  lift the `it.fails` quarantine in the field-zoo matrix.

Properties outside these classes (labels, descriptions, pure presentation hints)
**do not** require a proof — a static pointer remains sufficient. The ratchet
grows coverage where silent runtime breakage is plausible, not everywhere.

### 3. Phasing

- **Phase 1 (in progress).** Capability-matrix proofs for the two classes with a
  demonstrated break: field types ([#2022](https://github.com/objectstack-ai/framework/pull/2022), field-zoo) and analytics ([#2018](https://github.com/objectstack-ai/framework/pull/2018), tz bucketing).
- **Phase 2.** Extend the matrix to flow nodes, form widgets, and RLS patterns
  (the member-edit-others by-id-write hole, #1994, is the seed RLS proof — it
  also drives a multi-user harness capability reused by every later RLS proof).
- **Phase 3 (deferred, evidence-gated).** A generative pass that emits random
  valid metadata from the spec's Zod surface and asserts invariants — pursued
  **only** once the matrix proves the harness scales, and scoped to narrow
  high-value slices. Generative testing is high-ceiling and high-maintenance; it
  does not lead.
- **CI binding lands incrementally.** The liveness gate begins requiring `proof`
  for class (a) one class at a time as its matrix is populated, and for class (b)
  immediately. No big-bang demand to backfill all live properties.

### 4. Dogfood is the proof mechanism

A proof is a dogfood test because dogfood is the only gate that boots the real
stack in-process and exercises a property end-to-end (the thing that caught
#2018). In-process Hono request-injection keeps a proof at ~2s with no ports, so
the proof corpus stays CI-cheap as it grows.

## Consequences

- **Positive.** Closes *unproven liveness*: every high-risk authorable primitive
  an AI can emit carries a runtime guarantee, not just a "someone reads it"
  pointer. Every shipped regression leaves behind a permanent guard (the fix
  carries its proof). The three gates compose into one honest chain — *valid*
  (build) → *has a consumer* (liveness) → *runs correctly* (dogfood).
- **Negative / cost.** A proof is more work than a static pointer, and the
  dogfood harness must scale (per-class fixtures, boot cost). Mitigated by
  in-process inject (~2s/proof) and by scoping the requirement to high-risk
  classes on change — not a retrofit. Risk that the proof corpus slows CI;
  bounded by the same scoping and by keeping generative testing deferred.
- **Follow-up.** (1) Define the authoritative high-risk-class list and add the
  `proof` field + ratchet to the liveness gate. (2) The field-fidelity fix
  (`rating`/`slider`/`toggle`) is the first "regression carrier" instance — it
  must lift the field-zoo quarantine. (3) Seed the RLS proof (#1994) and the
  multi-user harness capability.

## Non-goals

- **Proving all 200 live properties now.** Trivial static properties don't need
  runtime proofs; the ratchet targets the high-risk class.
- **Building the generative tester now.** Deferred to Phase 3, evidence-gated.
- **Replacing unit tests.** Dogfood proofs add the *integration* dimension; they
  complement, not replace, layer-level unit tests. A proof must assert something
  a mocked unit test structurally cannot.
- **Client-side render proofs.** The backend dogfood harness covers
  server-reachable behavior. Pure objectui/React render correctness belongs in
  objectui's own suite; a property whose only failure mode is client render is
  out of scope for this gate.


---

## Update (2026-06-19) — the proof engine is now `@objectstack/verify`

The proof *mechanism* this ADR assigns to `@objectstack/dogfood` has since been
extracted into a published, app-agnostic package: **`@objectstack/verify`**
([#2041](https://github.com/objectstack-ai/framework/pull/2041)) — `bootStack`
(the real in-process stack via Hono request-injection), `deriveCrudCases`
(a runtime contract auto-derived from any app's metadata), `runCrudVerification`
(write → read → assert type fidelity), and `runRlsProofs` (the #1994
"can't-write-what-you-can't-read" invariant) — plus an `objectstack verify` CLI.

This sharpens the decision without changing it:

- **The gate vs. the engine.** `@objectstack/dogfood` remains the *gate* — the
  framework's own **hand-written golden proofs** (e.g. the #2018 tz-bucketing
  test, which `derive` can never auto-generate) — and now runs *on* the
  `@objectstack/verify` engine instead of carrying it. A `proof` (§1) is still a
  dogfood test; what changed is that the harness underneath it is reusable.
- **Phase 1 is now a reusable matrix.** The field-type matrix (#2022) is the
  published `deriveCrudCases` + `runCrudVerification`; the #1994 RLS seed is
  `runRlsProofs`. They are no longer internal to dogfood.
- **Phase 3 has a concrete vehicle.** `deriveCrudCases` — metadata → synthesized
  record → asserted round-trip — *is* the seed of the deferred generative pass;
  Phase 3 grows it rather than starting from zero.
- **Third parties get the same gate.** Because it is published, a third-party or
  template author runs the identical proofs against their own app
  (`objectstack verify --rls`), extending *prove-it-runs* beyond the framework's
  curated examples — the AI-authoring audience this ADR is written for. Validated
  against the external `hotcrm` app and the 9-app template corpus (#2041).

**Honest scope of the *auto-derived* path.** `@objectstack/verify`'s auto-derive
asserts only **scalar field round-trip fidelity** and the **by-id RLS invariant**,
and **skips** objects whose required fields it can't synthesize (lookups /
master-detail) and field classes it can't assert (computed/formula, flow nodes,
analytics bucketing, UI). A green `objectstack verify` therefore proves those two
dimensions over the auto-reachable subset — it does **not** subsume the
hand-written golden proofs, which is exactly why §4's gate keeps them. Closing
that gap (related-record topological synthesis; computed/flow/analytics
assertions) is the substance of Phases 2–3.
