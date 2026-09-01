# ADR-0099: Posture-Adjudicated Tiering — one axis for tier decisions, the EXTERNAL rung's enforcement path, no explicit deny

**Status**: Accepted (2026-07-18; proposed 2026-07-17) — P0 equivalence gate landed with the acceptance (see the Acceptance addendum); P1 shipped (#3226). Amended 2026-07-18: **two-axis correction** — D2's Layer 1 tier input corrected to the per-object scope bits, original P2 superseded by P2′ (see the Amendment)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) (the posture ladder + Layer 0 — Accepted, implemented; this ADR is its adjudication follow-through), [ADR-0066](./0066-unified-authorization-model.md) (superuser bypass ①; precedence), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) (D10 principal taxonomy / `audience`, D11 external OWD), [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) (membership lifecycle — where an external principal type would come from), [ADR-0094](./0094-sys-permission-set-pure-projection.md) (one-authority precedent)
**Composes with**: [ADR-0096](./0096-execution-surface-identity-admission.md) — 0096 governs **admission** (may this call reach the engine, as whom); this ADR governs **tiering** (given an admitted principal, which tier of rows each layer grants). Orthogonal axes, deliberately separate ADRs.
**Tracking**: framework#3211 (P0–P2 implementation) · framework#2920 (B-track follow-through, closed) · #2947→#2956 (posture carried on `ExecutionContext` — the unblocking prerequisite) · #2946 Finding 2 (the divergence class this ADR closes)
**Consumers**: `@objectstack/plugin-security` (Layer 0 exemption gate, superuser bypass, explain), `@objectstack/core` (`resolve-authz-context`, `posture-ladder`), `@objectstack/plugin-sharing` (EXTERNAL rung, when it activates), portal/external-identity work (ADR-0090 follow-up #6)

---

## TL;DR

ADR-0095 built the posture ladder (`PLATFORM_ADMIN > TENANT_ADMIN > MEMBER >
EXTERNAL`) and #2956 made the derived rung ride the `ExecutionContext` into
every enforcement entry point. But no enforcement decision *reads* it: each
tier decision still re-derives "what kind of principal is this" from raw
capability bits at its own site. That re-derivation is a bug class we have now
hit twice — #2949 (explain re-derived posture and diverged from enforcement)
and #2946 Finding 2 (the Layer 0 exemption keyed on `viewAllRecords`, which an
org admin also holds, so org admins crossed the tenant wall). Two sites, two
independent derivations, two divergences.

Three decisions:

1. **D1 — Posture is the single tier-adjudication input.** Every tier decision
   (Layer 0 exemption, Layer 1 short-circuit tier, explain's reported rung)
   reads the **carried** `ctx.posture`. Capabilities *derive* posture (ADR-0095
   D3) — enforcement never re-derives tier from capability bits at the point of
   decision. The per-side superuser bits keep gating the per-side bypass
   (posture selects the *tier*; the read/write bit still gates the *side*).
   Behavior-preserving behind an equivalence gate in the authz matrix.
2. **D2 — The posture → layer action map is normative.** One table (below)
   states what each rung means at each layer, with six invariants — most
   load-bearing: **TENANT_ADMIN never crosses Layer 0** (the #2946 Finding 2
   lesson, promoted from a fix to an invariant), and **enforcement and explain
   read the same carried value** (the #2949 lesson).
3. **D3 — The EXTERNAL rung gets its enforcement path, demand-gated.**
   Semantics were locked by ADR-0095 D2 (explicit shares only, never OWD).
   This ADR specifies the activation chain — `audience:'external'` (ADR-0090
   D10/D11) → `derivePosture` returns `EXTERNAL` → the rung's injection rule —
   and lands the matrix cells *now* so the rung cannot drift before a portal
   feature exists. Implementation is gated on an external principal type
   (ADR-0093 membership), not on a date.

**Rejected (D4)**: explicit deny / muting as an adjudication primitive. The
ladder's monotonicity — visibility strictly nested down the rungs, misconfig
can only narrow — is what makes the tier model provable and explain tractable;
deny-composition reintroduces the #2836 conflict class. Recorded with the
needs it would have served and where each is served instead.

---

## Context

### The carried-but-unread rung

The chain today, end to end:

- `resolve-authz-context.ts` derives the rung **once**, from capability
  grants (`derivePosture`, ADR-0095 D3) — landed with #2920 B2/B4.
- #2956 (closing #2947) added `posture` to `ExecutionContextSchema` and made
  both transports (REST `rest-server.ts`, runtime
  `resolve-execution-context.ts`) carry it — so enforcement middleware now
  *receives* the derived rung.
- **Nothing consumes it.** The Layer 0 exemption gate re-derives platform-ness
  from a capability probe (`hasPlatformAdminPosture`,
  `packages/plugins/plugin-security/src/security-plugin.ts#manage_metadata` — checking `manage_metadata` /
  `manage_platform_settings` / `studio.access` / `manage_users`); the
  Layer 1 superuser bypass reads the raw super-bits; the explain engine reads
  `ctx.posture` when present but replicates the derivation when absent
  (#2949's patch). The comment above the probe
  (`packages/plugins/plugin-security/src/security-plugin.ts`) still gives "the field is NOT plumbed" as the
  reason for probing — **that reason expired with #2956**; the probe is now a
  choice, not a necessity.

### Why per-site re-derivation is a bug class, not a style issue

Each site that re-derives "what tier is this principal" from raw bits is an
independent chance to get the mapping wrong, and the two mappings drift
independently:

- **#2946 Finding 2** — the Layer 0 exemption keyed on
  `viewAllRecords`/`modifyAllRecords`. Both a platform admin *and* an
  `organization_admin` hold those via wildcard grants, so the bits cannot
  distinguish the two top rungs — and org admins crossed the tenant wall on
  `access.default:'private'` objects. The fix (the platform-exclusive
  capability probe) is correct but is itself a *third* derivation of the same
  fact.
- **#2949** — the explain engine derived posture its own way and reported a
  rung enforcement did not use. Patched by preferring the carried value — a
  seam that only exists because enforcement doesn't read the same field.

One derivation site (the resolver), one carried value, N readers — the
divergence class closes by construction. This is the ADR-0094 one-authority
rule applied to a computed fact at its point of use.

### What this ADR is *not*

- Not a new ladder — ADR-0095 D2's enum, nesting invariant, and derivation
  (D3) are unchanged.
- Not admission — a context-less call is ADR-0096's problem (its D5 strict
  mode). This ADR assumes an admitted principal whose context the resolver
  built.
- Not a change to *what* any rung can see today — D1/D2 are
  behavior-preserving by contract; only D3 (EXTERNAL) adds behavior, for a
  principal type that does not exist yet.

## Decisions

### D1 — Posture is the single tier-adjudication input

Every enforcement-time **tier** decision reads `ctx.posture`:

- **Layer 0 exemption** (`security-plugin.ts` tenant-wall gate): crossing
  requires `ctx.posture === 'PLATFORM_ADMIN'` **and** the object-posture
  conditions of ADR-0095 D1 (platform-global / `private` / better-auth-managed
  — unchanged). The capability probe (`hasPlatformAdminPosture`) is retained
  as **fallback only** for contexts that did not pass through the shared
  resolver (hand-built contexts at direct engine call sites — the population
  ADR-0096 D3 is progressively eliminating). When both signals are present
  the carried rung wins; a disagreement is logged as a defect signal, and the
  **narrower** verdict is enforced (fail-safe).
- **Layer 1 short-circuit** *(superseded by the two-axis Amendment below)*: the
  original text read the tier from posture (`>= TENANT_ADMIN`) and claimed
  today's semantics. The pre-P2 verification (framework#3211) showed that is
  NOT today's semantics: the tier input is the **per-object** super-bit, which
  a custom set can delegate to a non-admin principal — a per-principal ×
  per-object fact the per-principal posture cannot represent. Layer 1's tier
  input therefore **stays the per-side, per-object capability bit**;
  `viewAllRecords` gates the read bypass, `modifyAllRecords` the write bypass,
  exactly as today. Posture never grants a side the bits don't.
- **Explain** reports the carried rung it read — the same field, not a
  replica. The #2949 fallback derivation retires once the resolver-built
  context is guaranteed on the explain path.

**Behavior contract.** D1 is behavior-preserving. The proof obligation is an
**equivalence gate**: the authz matrix (`authz-matrix-gate.test.ts`) gains
cells asserting, for every seeded principal shape, that the carried rung and
the site-local probe agree — *before* any reader flips. Any cell where they
disagree is a bug in one of the two derivations and must be resolved before
the flip (that is the gate doing its job; #2946 Finding 2 is exactly the class
it would have caught).

### D2 — The posture → layer action map (normative)

| Layer | `PLATFORM_ADMIN` | `TENANT_ADMIN` | `MEMBER` | `EXTERNAL` |
|:---|:---|:---|:---|:---|
| **Layer 0** (tenant wall) | exempt, where object posture permits (ADR-0095 D1) | **walled** — never exempt | walled | walled |
| **Layer 1** (business RLS) | short-circuit (side-gated by super-bits) | short-circuit within org (side-gated) | business RLS applies (ownership / depth / sharing) | **not evaluated** — the rung's rule replaces it |
| **OWD / sharing** | n/a (already all-rows in tier) | n/a within org | OWD baseline + shares + hierarchy widening | **explicit shares only — OWD and sharing *rules* never apply** |
| **Write path** | tier does not bypass write guards: readonly strip (#2957), identity write guard (ADR-0092), Layer 0 write wall (#2946) all still apply | same | same | shares with edit access only |
| **Explain** | reports the carried rung — identical input as enforcement, by construction | same | same | same |

> **Amendment note (2026-07-18):** the **Layer 1** row above is corrected by
> the two-axis Amendment — the tier at Layer 1 is *not* selected by posture;
> it is selected by the per-object super-bits (a `MEMBER` holding a delegated
> per-object `viewAllRecords` short-circuits business RLS on that object,
> tenant-walled as ever). The Layer 0 and EXTERNAL rows stand as written.

Invariants (each carries a matrix cell):

- **I1** — `TENANT_ADMIN` never crosses Layer 0. No capability composition may
  re-open it; only the `PLATFORM_ADMIN` rung reaches the exemption gate.
- **I2** — Visibility is strictly nested down the ladder within a tenant
  (ADR-0095 D2's invariant, now asserted at the adjudication site, not only at
  derivation).
- **I3** — Posture is derived only by the resolver, only from capability
  grants (ADR-0095 D3); no enforcement site re-derives tier at the point of
  decision (fallback probe excepted, per D1, and it may only narrow).
- **I4** — Enforcement and explain read the same carried value; a divergence
  is a defect, not a display issue.
- **I5** — Posture selects tier, never side: no rung grants a read or write
  bypass that the per-side capability bit does not.
- **I6** — Posture never bypasses system-context-only guards: `isSystem` /
  `SystemGrant` (ADR-0096 D2) remains the only write-path elevation; a
  `PLATFORM_ADMIN` human is not system.

### D3 — The EXTERNAL rung's enforcement path (demand-gated)

Semantics are already locked (ADR-0095 D2): an EXTERNAL principal sees only
rows explicitly shared to it; OWD baselines and sharing *rules* never widen
its visibility; misconfiguration can only narrow. What this ADR adds is the
**activation chain** so the rung turns on as one seam, not a scatter:

1. **Derivation**: when the resolved principal carries
   `audience: 'external'` (ADR-0090 D10; populated by the portal/external
   membership model when ADR-0093-track work delivers it), `derivePosture`
   returns `EXTERNAL`. Until such a principal exists the branch is dead code
   with live tests — identical staging to ADR-0095 D2's "defined and locked
   now, enforced later".
2. **Injection rule**: at the sharing/RLS seam the `EXTERNAL` rung compiles to
   the explicit-share filter *instead of* the member pipeline (OWD → RLS →
   sharing-rule widening). Absence of a share row yields the deny sentinel —
   fail-closed, never fall-through to the member rule.
3. **Write side**: edit requires an explicit share granting edit; the
   `owner`-type sharing rules currently marked
   `[experimental — not enforced]` (`packages/spec/src/security/sharing.zod.ts`, ADR-0049 marker)
   stay outside the EXTERNAL rung until separately enforced — an external
   principal's visibility never depends on an unenforced construct.
4. **Matrix first**: the `EXTERNAL × layer` cells land with this ADR
   (asserting the dead branch's rule against fixture shares), so the first
   portal PR inherits a green gate it must keep green, rather than authoring
   the rung's semantics under feature pressure.

Implementation is **gated on the external principal type existing** — the
ADR-0073/0096 idiom: specify now, enforce when the first consumer arrives.
The portal/licensing follow-up (ADR-0090 named follow-up #6) is the expected
consumer.

### D4 — No explicit deny / muting (Rejected as an adjudication primitive)

ADR-0066 deferred "explicit deny"; this ADR closes the question with a **No**
for the enforced model:

- **Why**: the ladder's value is monotonicity — rung ⊇ rung, additive grants,
  misconfig can only narrow (I2). A deny primitive makes effective access
  order-dependent across sources, reintroduces the #2836 conflict class
  (deny from one track out-composing allow from another) that ADR-0095 D3
  removed, and turns explain from "which grants admitted this row" into
  "which denials might have removed it" — the property that makes
  Salesforce-class models notoriously un-explainable.
- **Where the real needs live instead**: "this tier must not touch X" →
  object/field `requiredPermissions` capability gates (ADR-0066 D3) and FLS
  `editable:false`; "this surface must not act" → ADR-0096 admission; "narrow
  a grant's rows" → narrowing filters within the grant itself; "retire a
  grant" → ADR-0091 validity windows.
- **The one future door**: if permission-set *groups* ever land (deferred by
  ADR-0094), a group-scoped *muting* construct — subtractive **assembly** of a
  grant bundle before it enters adjudication — can be considered in that
  ADR. Assembly-time subtraction preserves adjudication monotonicity;
  adjudication-time deny does not. This ADR constrains that future: nothing
  subtractive enters the ladder itself.

## Sequencing and gates

Strictly serial, each step behind the matrix:

- **P0 (with this ADR)** — equivalence + invariant cells in
  `authz-matrix-gate.test.ts` (D1's probe-vs-rung agreement; I1–I6; the
  EXTERNAL dead-branch cells). Pure test additions; no behavior change.
- **P1** — flip the Layer 0 exemption gate and explain to read the carried
  rung (probe demoted to fallback; stale comment at
  `packages/plugins/plugin-security/src/security-plugin.ts` retired). Behavior-preserving under P0's gate.
  Unblocked today (#2956); small.
- **P2** *(superseded — rejected at adjudication, replaced by P2′; see the
  Amendment)* — the original "Layer 1 short-circuit reads posture for tier"
  turned out NOT to be behavior-preserving: it would inert the delegated
  per-object super-bit for non-admin principals. P2′ is documentation cells
  only (seeded-face agreement, the delegation cell, I7), zero behavior change.
- **P3 (demand-gated)** — EXTERNAL derivation + injection when the external
  principal type ships (portal track). New behavior for a new principal type;
  no existing principal's visibility changes. If any breaking surface
  emerges in P1–P3 it rides the same major as ADR-0096's D5 flip — one
  breaking window for both authz-model majors.

## Consequences

**Positive**
- The #2946-Finding-2 / #2949 divergence class ends by construction: one
  derivation, one carried value, N readers.
- The posture → action map becomes a normative, matrix-locked artifact — the
  kernel-side property the explainable-authorization track (record-grained
  explain, Studio access panel) needs to be *true* rather than best-effort.
- The portal/external product line inherits a fail-closed, pre-tested rung
  instead of authoring isolation semantics under deadline.
- The deny question is closed, not deferred — future grant-model work has a
  recorded constraint instead of an open door.

**Negative / accepted**
- A transition period with two live signals (carried rung + fallback probe)
  and the discipline that the narrower wins; retired as ADR-0096 D3 shrinks
  the hand-built-context population.
- More matrix cells to maintain (equivalence, invariants, EXTERNAL fixtures) —
  accepted; the matrix is the mechanism.
- `EXTERNAL` stays dead code until a consumer ships — carrying spec'd-but-idle
  branches is a cost ADR-0049 staging accepts deliberately.

**Explicitly unchanged**
- Rung derivation (ADR-0095 D3), the enum, and nesting semantics.
- Per-side superuser bits, system-context write guards (#2946/#2957,
  ADR-0092), and ADR-0096's admission machinery.
- Physical isolation (ADR-0002) and `single`-mode inertness of Layer 0.

## Alternatives considered

- **Keep per-site capability probes** (status quo). Rejected: two shipped
  divergences in one release cycle is the empirical case; every new
  enforcement site re-answers "what tier is this principal" and drifts
  independently.
- **Adjudicate directly on capability bits everywhere, drop the ladder.**
  Rejected: the bits cannot distinguish the two top rungs (#2946 Finding 2 —
  both hold `viewAllRecords`); the enum exists precisely because tier is not
  bit-expressible.
- **Store posture on the principal record.** Already rejected by ADR-0095
  (a second writable authority that drifts from grants); restated here
  because D1 makes the temptation stronger.
- **Model EXTERNAL as a maximally-restricted MEMBER.** Already rejected by
  ADR-0095 D2 (fail-closed demands the *absence* of OWD/sharing sources, not
  a data-driven restriction of them); restated as it becomes load-bearing at
  activation.
- **Explicit deny as a first-class grant type.** Rejected — see D4.

## References

- ADR-0095 (ladder, Layer 0, EXTERNAL semantics — Accepted) · ADR-0096
  (admission; the composing axis) · ADR-0090 D10/D11 (audience, external OWD)
  · ADR-0093 (membership → external principal source) · ADR-0094
  (one-authority precedent) · ADR-0066 (superuser bypass; deny deferred → D4)
  · ADR-0091 (validity windows) · ADR-0049 (specify-then-enforce staging).
- Incidents: #2946 Finding 2 (org admin crossed the tenant wall — the probe's
  origin), #2949 (explain/enforcement posture divergence), #2836 (dual-track
  conflict class).
- Landed substrate: #2920 B2/B4 (`posture-ladder.ts`, derivation), #2956
  (posture carried on `ExecutionContext` — closes #2947), #2957 (readonly
  write guard, I6), cloud#835/#836 (multi-org / position-anchor e2e gates).
- Code (current state): `packages/plugins/plugin-security/src/security-plugin.ts#hasPlatformAdminPosture`
  (`hasPlatformAdminPosture` probe; stale rationale at `#hasPlatformAdminPosture`),
  `packages/core/src/security/posture-ladder.ts`,
  `packages/core/src/security/resolve-authz-context.ts` (derivation),
  `packages/plugins/plugin-security/src/explain-engine.ts` (carried-value
  preference), `packages/spec/src/security/sharing.zod.ts` (`owner`-rule
  experimental marker), `packages/spec/src/kernel/execution-context.zod.ts`
  (`posture` field).

## Acceptance addendum (2026-07-18)

Accepted by the maintainer on 2026-07-18. The P0 equivalence gate landed with
this acceptance (#3211 M1, `authz-matrix-gate.test.ts`), and its cells sharpen
D1's behavior contract with one finding:

- **Seeded shapes verify equivalent.** For every seeded principal shape
  (unscoped `admin_full_access` holder, `organization_admin`, baseline member,
  the W1 permissive-policy fixture) the capability probe and the carried rung
  agree — D1's behavior-preserving claim holds across the seeded surface.
- **Two adversarial shapes diverge (probe `true` / rung `MEMBER`),** pinned as
  `KNOWN DIVERGENCE` cells: (a) a **scoped** `admin_full_access` grant — the
  set's contents merge (probe sees the platform capabilities) but the resolver
  counts only the *unscoped* grant (#2949 rule); (b) a custom set granting a
  platform-exclusive capability piecemeal (e.g. `studio.access`) without the
  unscoped grant. For these shapes the P1 flip is a **fail-safe narrowing**
  (rung ⊆ probe by seed construction — the I3 cell asserts the implication, so
  the flip can only withhold an exemption, never widen one), adjudicated
  per delta at #3211 G1 with a release-notes callout, and recoverable by
  granting the unscoped `admin_full_access`. This is the equivalence gate
  doing its job as specified ("any cell where they disagree … must be
  resolved before the flip") — the resolution is D1's rung authority, not a
  probe repair.

## Amendment — the two-axis correction (2026-07-18)

**Trigger.** P1 shipped behavior-preserving on the seeded face (#3226). The
pre-P2 verification (framework#3211) then found that D2's Layer 1 tier claim
was **not** behavior-preserving as written. Layer 1's tier input today is the
per-object super-bit — a **per-principal × per-object delegation primitive**:
a custom permission set may grant `viewAllRecords` on one object (all invoices
to an auditor position) without granting any admin stature. This is the
industry-standard shape (Salesforce object-level View All / Modify All,
org-level per-entity access in comparable platforms). Posture is
**per-principal** — one rung per principal — and structurally cannot carry
per-object scope: a MEMBER with a delegated invoice view-all and a plain
MEMBER sit on the same rung. Enforcing D2's MEMBER cell literally would have
(a) made a declared, grantable bit conditionally inert — the
declared-but-unenforced class ADR-0049 forbids and the silent-miss failure
mode this platform removes everywhere else — and (b) deleted a mainstream
delegation capability, forcing over-grants (promote the auditor to org admin)
to recover it.

**Decision (maintainer, 2026-07-18).** The model is corrected to **two
orthogonal axes, each with a single authority** — the table's Layer 1 row is
amended rather than enforced:

- **Posture is the boundary axis** (per-principal). It exclusively governs the
  ladder's *ends*: the Layer 0 cross-tenant exemption at `PLATFORM_ADMIN`
  (P1, shipped) and the EXTERNAL rung's wholesale replacement of the member
  pipeline (P3, demand-gated). No other enforcement site consults posture for
  tiering.
- **The per-object super-bits are the scope axis** (per-principal ×
  per-object). `viewAllRecords` / `modifyAllRecords` remain the only Layer 1
  tier input — per side, per object, delegable to any position; today's
  semantics, unchanged.
- **D1's "single adjudication input" refines to "single authority per
  axis."** The disease this ADR treats — one fact re-derived at multiple
  sites — stays dead: the boundary fact has one derivation (the resolver) and
  one enforcement reader (the Layer 0 gate); the scope fact has one evaluator
  (`PermissionEvaluator.hasSuperuser*Bypass`). Neither is derived anywhere
  else.
- **I7 (new — the I5 dual):** the scope axis never crosses a boundary the
  posture axis has not opened. A super-bit holder below `PLATFORM_ADMIN`
  stays tenant-walled (enforced by P1; pinned in the matrix), and an EXTERNAL
  principal's explicit-share rule replaces Layer 1 regardless of any held
  bits (pinned when P3 lands).
- **I2 clarification:** nesting is a per-rung *floor* invariant. Additive
  per-object grants widen visibility within a rung (two MEMBERs may differ)
  without violating the ladder; no rung's floor exceeds the rung above.
- **P2 → P2′.** The original P2 flip is rejected. P2′ lands documentation
  cells only: the seeded-face agreement pin (every seeded super-bit holder
  sits ≥ `TENANT_ADMIN`, so the axes agree on the seeded surface), the
  **delegation cell** (a MEMBER holding a custom per-object `viewAllRecords`
  on a private object sees all rows in-org and remains tenant-walled — the
  pattern is load-bearing and must not be "cleaned up" by a future
  convergence attempt), and the I7 cells. Zero behavior change. An
  authoring-time advisory for high-privilege bit grants (via
  `describeHighPrivilegeBits`) is tracked separately.

The AI-authoring rule this yields is one sentence — *bits pick your row scope
on an object; posture picks which tenant boundaries exist for you at all* —
which is the smallest mental model the platform can offer an agent writing
permissions, with no conditionally-dead declarations.
