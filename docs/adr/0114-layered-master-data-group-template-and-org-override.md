# ADR-0114: Layered Master Data — Group Template Rows and Organization Overrides

**Status**: Proposed (2026-07-30) — the follow-up ADR that [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) **D10** reserves. Per that reservation, none of the mechanics below may ship before this record is Accepted.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) (D2 union wall, D5 engine stamping, D6 grouping metadata + red lines, D12 entitlement), [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) (Layer 0 W1/W2 invariants), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert metadata), [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) (D5 fail-fast boot), [ADR-0092](./0092-sys-user-profile-field-delegation.md) (managed-table whitelist discipline); cloud ADR-0016 (强制免费、治理收费), cloud ADR-0081 (`@objectstack/organizations`)
**Tracking**: framework#4030 (split from #3541 at close-out); cloud-side distribution management stays under cloud#874
**Consumers**: `@objectstack/spec` (`data/object.zod.ts`), `@objectstack/core` (`resolve-authz-context`), `@objectstack/plugin-security` (`tenant-layer.ts`), `@objectstack/objectql` (engine write validation, resolved reads), `@objectstack/lint` (`validate-org-axis-red-lines`), `@objectstack/organizations` (cloud: distribution management)

---

## TL;DR

Group-shaped deployments need the SAP material-master / 用友-金蝶 shape: the
group publishes **template rows** (materials, suppliers, charts of accounts,
price lists), each plant **overrides the fields it is allowed to localize**,
and everything else stays group-governed — one source of truth, per-org
variance only where declared.

This ADR proposes the mechanics ADR-0105 D10 deliberately deferred:

- **Declaration** (D1): an object opts in with a strict `masterData.layered`
  block naming its `overridableFields` and a `distribution` policy
  (`centralized` 集团统管 / `tiered` 分级; 自由 = don't declare the block).
- **Model** (D2): one object, row-shadowing — template rows are marked
  (`is_master_template`) and owned by the publishing organization; override
  rows link them (`master_template_id`), are owned by the consuming
  organization, and **may physically carry only overridable fields** —
  group governance is enforced at write time, not hoped for at read time.
- **Reach** (D3): template rows published by an org's **ancestors** (the
  ADR-0105 D6 `parent_organization_id` tree) are readable through the tenant
  wall. This is the platform's **first deliberate exception to the D2 union
  predicate** — engine-owned, Layer-0-composed, read-only, row-marked,
  object-scoped — which is exactly why it needs its own decision record
  instead of riding an implementation PR.
- **Resolution** (D4): raw reads stay byte-identical to today; an explicit
  *effective* read merges template + override field-wise. The logical entity
  id is the **template row id** — override rows are attribute shadows, not
  addressable entities.

The wall exception never widens writes, confers no grants, and does not walk
the org tree for anything but published template rows — ADR-0105 D6's red
line ① ("no permission inheritance along the org axis") stays absolute.

---

## Context

### The customer shape

The three-plants-one-group dogfood (cloud#880) proved membership, visibility,
and write walls. The next thing every group-shaped customer asks for is the
master-data shape those walls now make awkward:

- **SAP** splits the material master into client-level data (MARA — one row
  per material, group-governed) and plant-level data (MARC — per-plant
  attributes: MRP type, purchasing group). A material *exists once*; plants
  localize declared aspects of it.
- **用友 / 金蝶** ship this as 集团统管 (group-controlled: subsidiaries
  consume, cannot author), 分级 (tiered: each level authors for its subtree),
  and 自由 (free: no group governance) — a per-archive distribution policy,
  with field-level 管控 on which attributes a subsidiary may change.
- **NetSuite/Dataverse** reach the same end differently (subsidiary
  restrictions on shared records; BU-owned rows with org-wide read
  privileges) — shared master rows with scoped local variance is the
  convergent product shape.

### What a builder can do today, and why each encoding fails

| Encoding | What breaks |
| :-- | :-- |
| **Platform-global object** (`tenancy.enabled: false`) | No wall at all — every org sees and (FLS permitting) edits everything; no per-org override rows; all-or-nothing. |
| **Per-org copies** (seed/replay each org, cloud#884 path) | Drift by design: a group price update is a re-distribution sweep, not a write; no engine knowledge of which fields were meant to stay group-governed. |
| **Sharing rules across orgs** | Not expressible: every recipient type is org-internal (ADR-0105 D6 red line ②), and ADR-0111 just made the sharing surface *principled*, not wider. Widening it would create a second wall-crossing channel. |
| **Two hand-rolled objects** (template object + org object, lookup between) | Buildable today, zero engine help: nothing stops an org row from shadowing a non-overridable field, every consumer joins manually, references split across two id spaces. |

The absence is real, the demand is the first thing SAP-shaped customers ask,
and every workaround erodes exactly the guarantee (`group` governance) that
makes master data *master* data.

### The tension this ADR exists to resolve

ADR-0105 D6 red line ①: **"No permission inheritance along the org axis.
Cross-org visibility comes from membership union (D2), never from walking an
org tree."** Lint-enforced (`validateOrgAxisRedLines`).

Template reach *walks the org tree for visibility*. If that walk were a
permission channel, this ADR would be re-opening the mistake ADR-0057 D5
retired. The resolution is to name precisely what crosses the wall:

- **What crosses**: read access to individual rows explicitly published as
  templates (`is_master_template: true`), on objects explicitly declared
  layered, from orgs on the reader's ancestor chain. Data reach, downward,
  read-only.
- **What never crosses**: grants, positions, permission sets, admin scopes,
  write access of any kind, and *every row that is not a published template*.
  A group admin gains no authority in a plant; a plant gains no reach into
  the group beyond the published rows themselves.

The red line bans **capability** flowing along the org tree. Template reach
is **data** flowing along it, one marked row at a time, under a declared
object contract. This ADR amends D6 to record that distinction rather than
quietly carving through it.

One historical footnote: `tenancy.crossTenantAccess` was removed from the
spec after v15.0 as consumer-less (ADR-0049 cleanup; see the tombstone in
`data/object.zod.ts`). D3 below is the *enforced* answer to the one narrow
case that key gestured at — an engine-owned mechanism, not a config flag that
promises what nothing implements.

---

## Decisions

### Declaration

**D1 — A strict `masterData.layered` block on the object.**

```yaml
name: product_material
tenancy: { enabled: true }
masterData:
  layered:
    overridableFields: [purchase_price, mrp_type, local_notes]
    distribution: centralized   # or: tiered
```

- `overridableFields` — the only fields an override row may carry (D2). Must
  name real, non-system, non-org-axis fields (D7 lints).
- `distribution: 'centralized'` (集团统管) — only the group root authors
  templates; non-root orgs may write **only** override rows.
  `'tiered'` (分级) — any org may publish templates for its own subtree, and
  orgs may also hold standalone local rows.
- 自由 (free) is **the absence of the block**, not a third value — an
  undeclared object keeps plain org-scoped rows. This keeps ADR-0078 honest:
  every declared key changes engine behavior; there is no inert spelling.
- The block follows the `tenancy` block's discipline: `.strict()`, tombstoned
  retirements, refusal — not stripping — on unknown keys.

### Model

**D2 — One object, row-shadowing, write-time governance.**

Layered objects gain two system-managed fields (spec-level, like the D5
tenant column):

- `is_master_template` (boolean) — marks a published template row. Owned by
  the publishing org (`organization_id` stamped per ADR-0105 D5, unchanged).
- `master_template_id` (self-lookup) — links an override row to its template.
  Owned by the consuming org.

Engine-enforced write rules (same layer as ADR-0105 D5's forged-org
refusal — refusal, never silent dropping):

1. An override row (**`master_template_id` set**) may carry **only**
   `overridableFields`. A write naming any other field is refused loudly —
   this is the group-governance guarantee, enforced where it is cheap
   (write time) instead of reconstructed where it is not (read time).
2. At most **one override per (template, org)** — enforced with the
   per-tenant unique machinery (#3696).
3. Under `centralized`, a non-root org cannot set `is_master_template` and
   cannot insert a standalone row (no `master_template_id`); under `tiered`,
   an org may set `is_master_template` only on rows in its own org —
   subtree reach is derived by *readers* walking up (D3), never by a writer
   targeting down.
4. `is_master_template` and `master_template_id` are mutually exclusive on a
   row, and immutable after insert except through an explicit publish/retract
   verb (Phase B scope) — flipping governance silently on a live row is an
   audit event, not an update.

Publishing requires nothing new: ordinary create/edit rights on the object in
the publishing org (plus FLS). No new capability bit; the *distribution
policy* is what constrains who may author what, and it is object metadata,
not a grant.

### Reach

**D3 — The wall exception: ancestor-published templates are readable, and
only readable.**

`resolveAuthzContext` (which already computes `accessible_org_ids`, ADR-0105
D2) additionally computes `template_org_ids`: the ancestor closure of the
accessible set along `parent_organization_id`, minus the accessible set
itself — reusing the D9 walk (cycle-guarded, `approver-org-scope.ts`
pattern). `computeTenantLayer0Filter` gains the matching optional inputs
(`templateOrgIds`, `objectIsLayered`) and, **on layered objects under `group`
posture, for reads only**, widens:

```
organization_id IN accessibleOrgIds
  OR (is_master_template == true AND organization_id IN templateOrgIds)
```

Bounds, each load-bearing:

- **Read-only.** The write-side filter keeps the plain union/equality —
  a plant can never write a group row through the widened branch, and the
  branch never feeds VAMA, sharing, or any authority probe.
- **Layer-0-owned.** The OR lives inside the tenant layer, AND-composed
  first, exactly like the wall it widens — so ADR-0095 W1 (business RLS
  cannot weaken it) and W2 (the superuser bypass cannot cross it) hold
  unchanged. Business RLS still ANDs on top and can *narrow* template
  visibility per org; nothing below Layer 0 can widen it.
- **Fail-closed.** Absent/empty `templateOrgIds`, unresolvable tree, non-
  layered object, non-`group` posture → no widening; the predicate is
  ADR-0105 D2's, byte-identical.
- **Not the `PLATFORM_ADMIN` rung.** The existing exemption is untouched;
  this branch is narrower in every dimension (rows, direction, verbs) and
  shares no code path with it.

**D4 — Raw by default; effective on request; the template id is the entity.**

- Default reads return physical rows — every existing consumer, export, and
  test stays byte-identical. No silent collapsing.
- An explicit **effective read** (a query-level `resolve: 'effective'` mode)
  returns one logical row per template visible to the caller's active org:
  override values win on `overridableFields`, template values everywhere else
  (which, by D2 rule 1, is the only merge even *representable*). Standalone
  local rows (tiered) pass through unmerged.
- **References point at the template row id.** An override row is an
  attribute shadow, not an addressable entity: lookups from transactional
  documents (a purchase order's material) store the template id, and
  effective resolution localizes at read/expand. This keeps one id space —
  the SAP lesson (documents key on the material, never on MARC rows).

### Governance and posture

**D5 — `group` posture only; refusal everywhere else; no new entitlement
axis.**

A layered declaration deployed into `single` or `isolated` **refuses at
boot** (ADR-0093 D5 fail-fast doctrine; D9 set the precedent that posture
mismatches are audit events, not silently inert config — a `group` →
`isolated` migration must not silently turn group-governed archives into
plain org rows). `os lint` flags it at author time; the runtime refusal is
the enforcement (a lint cannot see environment posture).

Entitlement rides ADR-0105 D12 unchanged: layering activates only under
`group`, which `@objectstack/organizations` entitles via `supportedPostures`.
All enforcement above is open-core (iron rule: 强制免费). Cloud sells the
*distribution management* around it — 分发单 UI, per-org rollout/replay jobs,
coverage analytics, retract tooling — under cloud#874 (治理收费).

**D6 — ADR-0105 D6 red line ① is amended, not breached.**

The red line's text gains one sentence: *"Published master-data template rows
(ADR-0114) are readable along the ancestor chain — data reach for marked rows
on declared objects, read-only; this is not permission inheritance, and no
other visibility, grant, or write authority may ride the org tree."* The lint
that enforces the red line is extended, not relaxed (D7).

### Enforcement surface

**D7 — Lints, conformance, acceptance.**

- `validateOrgAxisRedLines` grows: `overridableFields` must exist on the
  object and exclude system/org-axis/identity fields (`organization_id`,
  `owner_id`, `is_master_template`, `master_template_id`, better-auth-managed
  columns); layered requires `tenancy.enabled`; layered on a better-auth-
  managed object is refused; `distribution` is mandatory inside the block.
- Conformance-matrix rows + `authz-matrix-gate` snapshot: any visibility
  delta beyond marked template rows on declared objects is a bug — same
  guardrail ADR-0105 D4 used for the VAMA hot path.
- Acceptance extends the three-plants dogfood (`ee-group-showcase`,
  alongside cloud#919's sharing rows): plant reads the group's template;
  plant override shadows only declared fields and a write naming an
  undeclared field is refused; plant B sees the template but never plant A's
  override; a plant forging `is_master_template` under `centralized` is
  refused; the write filter under the widened read is proven unwidened
  (the #3623 lesson: assert at the driver seam, not just the pure function).

**D8 — Adoption is loud.**

Declaring layering on an object with existing rows is validated at boot:
under `centralized`, pre-existing standalone org rows are a refusal naming
the migration path (`os migrate master-data --link-by <field>` — Phase B
tooling that links copies to a chosen template and diffs non-overridable
drift); under `tiered` they are legal standalone rows as-is. No silent
reinterpretation of existing data.

---

## Non-goals

- **Cross-environment distribution** (publishing templates between
  deployments) — cloud territory, out of scope entirely.
- **MDM matching/dedup/survivorship** — this ADR distributes governed rows;
  it does not decide which of two suppliers is the same supplier.
- **Approval workflows on master-data changes** — existing approvals compose
  (a template edit can carry an approval like any write; D9 cross-org
  targeting already lets a plant request a group sign-off).
- **A per-org × per-field 管控 matrix** beyond one `overridableFields` list —
  the 用友 full matrix is expressible later as a superset (`overridableFields`
  per distribution tier); nothing here forecloses it.
- **Any cross-org mechanism in `isolated` posture** — the hard wall stays
  absolute; cross-env replication remains the (cloud) answer there.

## Phasing

- **Phase A (spec + lint + refusals)**: D1 block parses strictly, D7 lints,
  D5 boot refusal. Lands *with* Phase B in one train — admission without
  enforcement would be ADR-0078's inert-metadata trap.
- **Phase B (engine)**: D2 write rules, D3 context + Layer 0 widening, D4
  effective reads, D8 migration tool, conformance + dogfood rows.
- **Phase C (cloud)**: distribution management UI/jobs, analytics — cloud#874.

## Alternatives considered

**Platform-global master objects** (`tenancy.enabled: false`). Loses the wall
entirely and cannot express override rows. Rejected — it is the encoding
customers reach for first and the one that leaks everything.

**Copy-on-distribute** (金蝶-style 分发: physically copy template rows into
each org; cloud job, zero engine change). Seriously considered — it needs no
wall exception at all. Rejected because it surrenders the actual product:
after the copy, nothing enforces that non-overridable fields stay
group-governed; every group update becomes a re-distribution sweep with
drift-diffing; "one source of truth" becomes "N sources, eventually
consistent". The engine-enforced `overridableFields` contract *is* the
feature. (Cloud may still ship copy-based distribution for `isolated`
deployments — out of scope here.)

**Cross-org sharing rules.** Would require inventing cross-org recipients —
breaching D6 red line ② and turning the just-hardened ADR-0111 surface into a
second wall-crossing channel. One wall, one exception, one place to audit.

**Two-object split (MARA/MARC as separate objects).** Expressible today,
kept as an app-level pattern; rejected as the platform answer — no engine
guarantee on shadowed fields, two id spaces for one entity, every consumer
re-implements the join.

**A `crossTenantAccess`-style config flag.** Declared-but-unenforced access
policy — the exact ADR-0049 class the v15 cleanup removed. Never again.

## Consequences

**Positive.** The SAP/用友 group shape becomes declarative: template + declared
variance + engine-enforced governance, zero custom security code — the same
pitch as ADR-0105 Phase 1, one layer up the product. The wall exception is
narrow, marked, object-scoped, read-only, and lives in the one file whose job
is the wall.

**Negative / accepted.**
- Layer 0's pure function gains its first OR branch. The bound is the input
  shape (`templateOrgIds` resolved upstream, empty ⇒ no-op), and the
  authz-matrix snapshot pins every visibility delta — but the wall predicate
  is no longer *one* comparison, and reviewers of `tenant-layer.ts` must now
  hold two.
- `resolveAuthzContext` adds an ancestor walk per request on top of D2's
  membership read. #3541's evaluation already recorded that this resolver has
  **no cache** (the "60s envelope" belongs to the session snapshot, not the
  resolver) — D3 deepens that cost, and a resolver-caching decision is now
  worth its own issue *before* Phase B lands at scale.
- Effective reads introduce a second read mode consumers must choose
  deliberately. Raw-by-default protects existing behavior at the price of an
  adoption step for product surfaces.

**Neutral.** Objects that never declare the block see zero change — the
widened branch is unreachable without the declaration, the fields, and the
posture all present.

## References

- ADR-0105 D10 (the reservation), D2/D5/D6/D12; ADR-0095 W1/W2; ADR-0111
  (the adjacent authorization face this deliberately does not touch).
- Code seams: `plugin-security/src/tenant-layer.ts`
  (`computeTenantLayer0Filter`), `core/src/security/resolve-authz-context.ts`,
  `plugin-approvals/src/approver-org-scope.ts` (the ancestor walk to reuse),
  `lint/src/validate-org-axis-red-lines.ts`, `spec/src/data/object.zod.ts`
  (the `tenancy` block whose discipline D1 copies).
- Tracking: framework#4030; cloud#874 (Phase C), cloud#919 (dogfood
  neighbors).
