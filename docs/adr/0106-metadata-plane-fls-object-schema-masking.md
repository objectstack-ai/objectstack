# ADR-0106: Metadata-Plane Field-Level Security — Per-Caller Masking of Object Schemas

**Status**: Accepted (2026-07-27; implemented 2026-08-08 — #3682)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove, fail-posture discipline), [ADR-0066](./0066-unified-authorization-model.md) (unified authz; D3 field `requiredPermissions` — mask on read, deny on write), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) (permission set as the only capability container; `readable`/`editable` FLS bits), [ADR-0046](./0046-package-docs-as-metadata.md) (§6.7 audience gate — the existing per-caller metadata read gate this ADR generalizes from)
**Tracking**: #3661 (steps ① ② shipped client-side as objectui#2866; this ADR is step ③)
**Consumers**: `@objectstack/rest` (`/meta` routes), `@objectstack/runtime` (`/metadata` dispatch), `@objectstack/plugin-security` (`getReadableFields`), `@objectstack/metadata-protocol` (explicitly **unchanged**), ObjectUI console

---

## TL;DR

The data plane enforces field-level security everywhere it matters — list
reads mask values, exports project columns (#3498 → #3547 → #3561 → #3649),
and the write path 403s forbidden fields — but the **metadata plane ships the
full object schema to any authenticated caller**. A caller with no read access
to a field still receives its name, label, type, picklist option values,
formula expression, `visibleWhen` predicate, default value, and the
`requiredPermissions` capability names guarding it. ObjectStack is a
development platform: whether a deployment's authenticated callers are trusted
is the customer's call, not ours, so the platform must enforce, not assume.

- **D1** — Object-schema reads are FLS-masked per caller: fields the caller
  cannot read are removed from the served schema **entirely**. Masking keys on
  the `readable` bit only; `editable` remains the domain of
  `/auth/me/permissions`.
- **D2** — Masking runs in the dispatch layer (REST + runtime) *after* the
  protocol fetch, via the already-registered
  `security.getReadableFields(object, ctx)` (#3547). `getMetaItem` stays
  caller-free.
- **D3** — The shared metadata cache keeps storing **one full copy** per
  object; masking is applied after cache retrieval, and the caller's
  field-visibility fingerprint is folded into the ETag so `304` semantics stay
  correct per permission cohort. No per-user cache blowup; unrestricted
  callers get byte-identical responses to today.
- **D4** — `isSystem` and platform-admin callers are exempt (Studio/Setup
  authoring requires the full schema).
- **D5** — Coverage is the complete set of schema-serving outlets: single-item
  read (cached + uncached), list read, and the runtime `/metadata` catch-all —
  plus an audit of any other schema-bearing endpoint.
- **D6** — Failure posture is three-tier: *no security service* → serve
  unmasked (the deployment has no FLS posture); *cannot determine*
  (`undefined`) → serve unmasked **with telemetry and private cache headers**;
  *evaluation throws* → **fail the request (5xx)** — never serve the unmasked
  body on an error path, and never serve an empty-fields `200`.
- **D7** — Callers that resolve to zero permission sets go through the same
  fallback-set resolution `/auth/me/permissions` uses, so guest/public
  deployments get a deliberate posture instead of an accidental full-schema
  default.
- **D8** — Default **on**, ships with the current major; config escape hatch
  for deployments that explicitly want an unmasked metadata plane.

**Rejected**: documenting "the metadata plane does not mask" as the platform
default (indefensible once callers are untrusted); per-caller cache keys
(cache blowup); threading caller identity into `metadata-protocol` (radius,
and it would break the single-copy cache); serving object reads fully
cache-bypassed as the end state (acceptable fallback, not the target). See
Alternatives.

---

## Context

### What leaks today, and why it matters on a platform

`GET /meta/object/:name` (REST), `GET /meta/object` (list), and the runtime
`/metadata` catch-all all return the object schema exactly as the protocol
stores it. The only gate is the anonymous/`requireAuth` check. Per-caller
filtering exists in the same handler for **other** types — `app` goes through
`filterAppForUser`, `dashboard` through the `requiresService` gate, `book`/
`doc` through the ADR-0046 §6.7 audience gate — but `object`, the type whose
fields FLS is *about*, has none.

The leak is not just field names. A schema field carries its label, type,
**picklist option values** (which may themselves be sensitive enumerations),
**formula expressions** (business logic that may reference masked fields),
`visibleWhen` CEL predicates, default values, and — via ADR-0066 D3
`requiredPermissions` — the names of the capabilities guarding it. This is
the metadata-plane twin of the export-header leak the #3391 series closed on
the data plane.

An earlier disposition ("target deployments have no untrusted authenticated
users, so document no-masking as the default") died on the platform premise:
ObjectStack customers build portals and products whose authenticated callers
the platform cannot vouch for. Enforcement must be the platform default
(ADR-0049).

### Business context — what masking is worth

The value scale of this ADR is not "prevents data breaches" (the data plane
already enforces reads and writes); it is what the *disclosure* boundary
buys the platform and its customers:

- **The invariant becomes claimable.** After this ADR the platform can state
  — in security questionnaires, audits, and competitive POCs — one complete,
  testable sentence: *a field the caller cannot read does not exist for that
  caller, on any plane*. Today a competent pentester falsifies the "we have
  field-level security" claim with a single unauthenticated-of-privilege
  `curl /meta/object/<name>`; a pentest finding is remediation cost and a
  deal blocker. The industry benchmark behaves this way already —
  Salesforce's `describe` omits fields the caller cannot read — so "FLS
  comparable to Salesforce" is only true once this ships.

- **Only the platform can fix it.** Data-plane exposure is configurable by
  customers through permission sets; what `/meta` serves is not. A customer
  building a dealer/supplier/patient portal has **no** remediation available
  in their own tier today except modeling discipline ("keep sensitive fields
  off portal-visible objects"). One platform-side fix is inherited by every
  deployment — the classic platform-leverage shape.

- **It unlocks mixed-sensitivity modeling.** Without masking, the honest
  guidance forces *object splitting*: the same business entity duplicated
  into an internal object and a portal object, with synchronization,
  reporting, and flow costs doubled. With masking, "one `account` object —
  40 fields for staff, 12 for dealers" is a supported, first-class modeling
  style. That is a product capability (external users on the primary data
  model), not merely hygiene.

- **Schema shape is itself business information.** Field names alone answer
  "what does this company record" (`salary_grade`, `layoff_flag`, a
  diagnosis field); picklist option sets are operational taxonomies
  (customer tiers, risk bands); formula expressions are pricing and scoring
  IP; `requiredPermissions` names hand an attacker the exact capability to
  escalate toward. Removing the schema removes the reconnaissance map — the
  cheapest layer of defense in depth.

Against this, the cost side is deliberately near-zero (D3: unrestricted
callers get byte-identical responses; cache storage unchanged) with an
escape hatch (D8) — which is the business case for shipping it in the
current major rather than deferring.

### What is already in place

- `security.getReadableFields(object, ctx)` (#3547): the authoritative
  readable-column set for a caller — `isSystem` bypass, permission-set
  resolution, ADR-0066 D3 `requiredPermissions` AND-gate folded in. Returns
  `undefined` when the field universe is unresolvable. The export path
  already consumes it.
- The write path already 403s forbidden fields (ObjectQL security middleware
  step 2.5), so this ADR is about **disclosure**, not write authorization.
- `/auth/me/permissions` already serves per-caller `{readable, editable}`
  bits to the UI, and after objectui#2866 (steps ① ② of #3661) every
  client-side field gate consumes that channel; the dead declared-but-never-
  enforced `field.permissions` schema shape was removed per ADR-0049.
- The `doc`/`book` audience gate already established "per-caller metadata
  reads bypass the shared cache" as an acceptable pattern — for cold reads.
  Object schemas are the hottest metadata read (every list/form/detail render
  fetches them), which is why this ADR does better than a bypass (D3).

---

## Decisions

### D1 — Mask by `readable` projection; remove masked fields entirely

Serving an object schema to caller *C* projects `fields` onto
`getReadableFields(object, C)`. A field outside the set is removed **whole**
— name, label, type, options, formula, `visibleWhen`, `defaultValue`,
`requiredPermissions`, everything. Partial redaction (keep the name, strip
the rest) still leaks existence and invites clients to render ghost columns.

Masking keys on `readable` **only**. A readable-but-not-editable field stays
in the schema — the UI must render it (disabled where relevant), and the
`editable` affordance is already served per caller by
`/auth/me/permissions`. Consequently this ADR needs **no**
`getEditableFields` dual: the import-template concern that motivated one
(#3661 §5) was resolved client-side by objectui#2866, and the server's write
gate remains the enforcement boundary.

Division of labor after this ADR:

| Layer | Mechanism | Question it answers |
|---|---|---|
| Data plane — read | engine middleware `maskResults` | "what values can I see" |
| Data plane — write | middleware step 2.5 explicit 403 | "what fields can I write" |
| Metadata plane | **this ADR** — schema projection | "what fields exist, shaped how" |
| UI affordance | `/auth/me/permissions` + `checkField` | "how should the UI behave" |

### D2 — Enforce in the dispatch layer; the protocol stays caller-free

Masking runs in `@objectstack/rest` (`/meta` handlers) and
`@objectstack/runtime` (`domains/meta.ts`) after the item is fetched,
calling the registered `security` service. `protocol.getMetaItem` /
`getMetaItems` signatures are **unchanged**: the protocol remains a
caller-free, cacheable source of truth, which is precisely what makes D3's
single-copy cache sound. Threading `userId`/permission sets into the
protocol was rejected (see Alternatives).

### D3 — Mask after cache; fold a visibility fingerprint into the ETag

The shared metadata cache (`getMetaItemCached`) keeps storing **one full
schema per (type, name, locale, environment)** — no caller dimension in the
cache key. The pipeline becomes:

```
fetch (shared cache or protocol) → mask for caller → send
```

with the **ETag** extended by the caller's field-visibility fingerprint for
that object: a stable hash of the caller's *denied* field set (empty for
unrestricted callers). Properties:

- Unrestricted callers (the overwhelming majority in most deployments)
  produce an empty fingerprint → byte-identical ETags and bodies to today;
  zero regression.
- Callers in the same permission cohort share `304`s.
- A permission change alters the fingerprint → the stale `304` path
  self-invalidates.
- Cache storage stays O(objects), not O(users × objects).

The masking step is *inside* the cached path, before headers are emitted —
there must be no code path on which the cached full body reaches the wire
without passing the mask (this ordering is also what makes D6's error tier
safe). A full cache bypass for restricted callers (the `doc`/`book`
pattern) is the acknowledged fallback if fingerprinting proves awkward in
implementation — correct, simpler, but it forfeits `304`s on the hottest
metadata read, so it is a stepping stone, not the end state.

### D4 — Exemptions: `isSystem` and platform admins

`getReadableFields` already bypasses for `isSystem`. Platform-admin callers
(the same `systemPermissions`-based judgment the `app` filter uses) are
likewise exempt: Studio/Setup authoring requires the full schema, and
draft/preview reads are admin-gated upstream already. The exemption is a
*caller* property, not a route property — an admin hitting the public route
gets the full schema; a non-admin hitting any route gets the projection.

### D5 — Coverage: every schema-serving outlet, or the mask is decoration

1. `GET /meta/object/:name` — **both** the `getMetaItemCached` fast path and
   the uncached `getMetaItem` path.
2. `GET /meta/object` — the list read (`getMetaItems`); each item projected
   the same way.
3. Runtime `/metadata` catch-all (`domains/meta.ts` object branch) — both the
   protocol-backed and registry-backed lookups.
4. An implementation-time audit of other schema-bearing outlets (OData
   `$metadata`/describe-style surfaces, client SDK describe calls); anything
   found either routes through the same projection or is filed per Prime
   Directive #10.

### D6 — Failure posture: three tiers, never silent, never empty-200

| Failure | Posture | Rationale |
|---|---|---|
| `security` service not registered | Serve unmasked | The deployment has no FLS posture at all — the data plane doesn't mask either; the metadata plane tightening alone would be theater. |
| Service present, `getReadableFields` → `undefined` (field universe unresolvable) | Serve unmasked **+ structured warn + metric**, and downgrade the response to `Cache-Control: private, no-store`, no shared ETag | Matches the two same-class precedents (engine middleware: unresolvable → no mask; #3547 export: `undefined` → no projection). The window is operational (registry hydration), not attacker-inducible — the request carries only `type`/`name`; a caller cannot construct the failing state without authoring rights. Failing closed here bricks every render of the object for every user and risks a bootstrap deadlock: permission sets are themselves metadata, and the console cannot reach "permissions resolvable" if `/meta` refuses to serve while security warms up. |
| Permission evaluation **throws** | **Fail the request (5xx)** | An unhealthy security service must not auto-open a disclosure hole — infra failures are far more frequent than hydration windows. The only safe closed form is an *error*: visible, retryable, never cached. Serving an empty-fields `200` is the worst option — silently wrong UI **and** cacheable poison. D3's ordering guarantees the cached full body cannot leak on this path. |

Reconciliation with ADR-0049: enforce-or-remove targets *silent* unenforced
properties (exactly what the removed `field.permissions` shape was). Here
enforcement exists; the degraded tier is an explicit, argued, **observable**
decision — the `undefined` tier must emit telemetry loud enough that a
deployment living in it is a visible operational condition, not a quiet
default. The `doc`/`book` fail-closed precedent is *access control on
content* (the payload itself is the secret, and one unrendered doc does not
cascade); schema masking is *disclosure control on infrastructure* (every
surface depends on it) — different class, different posture.

### D7 — Zero-permission-set callers resolve the fallback set

Today `getReadableFields` returns the full field set when no permission sets
resolve (mirroring the engine middleware). For masked metadata reads, a
caller resolving to zero sets goes through the same fallback resolution
`/auth/me/permissions` uses (`security.fallbackPermissionSet`, default
`member_default`; guest-facing deployments point it at their guest set). A
public deployment's schema exposure thereby becomes a deliberate
permission-set decision, not an accidental everything-default. Anonymous
callers on `requireAuth` deployments remain blocked before any of this.

### D8 — Default on, current major, config escape hatch

Masking is the platform default and ships with the major release already in
flight (the same train as objectui#2866's breaking removal). A server config
key (`metadata.maskObjectFields: false`-style, exact name at implementation)
opts a deployment out — after #2866 the UI reads all field affordances from
`/auth/me/permissions`, so toggling the mask changes disclosure only, never
UI correctness. ①'s client-side gates are **not** superseded: the schema
mask handles existence; the client channel still drives
readable-but-disabled rendering and payload stripping. The two layers are
complementary by design.

---

## Alternatives considered

- **Document "no masking" as the explicit default** (the pre-platform-premise
  disposition). Defensible only while every authenticated caller is trusted;
  a development platform cannot promise that on customers' behalf. Rejected.
- **Per-caller cache keys.** Correct, simple, O(users × objects) cache
  entries. Rejected for blowup; the fingerprint-ETag gets cohort-correct
  `304`s at O(objects) storage.
- **Thread caller context into `metadata-protocol`.** Largest radius: every
  `getMetaItem` call site, and the protocol's single-copy cacheability —the
  property D3 exploits — is lost. The dispatch layer already resolves
  execution contexts for the `app`/`dashboard`/`doc` gates. Rejected.
- **Full cache bypass for object reads** (`doc`/`book` pattern) **as the end
  state.** Correct and simple, but object schemas are the hottest metadata
  read; forfeiting shared `304`s there is a real cost. Kept as the
  acknowledged implementation fallback (D3), rejected as the target.
- **Fail-closed on `undefined`** (D6 middle tier). Symmetric-looking but
  wrong class: it converts an operational hydration window into a full
  rendering outage with a bootstrap deadlock risk, to prevent a bounded
  disclosure that two same-class precedents already accept. Rejected —
  with the compensating requirement that the open tier be loudly observable.

---

## Consequences

- A caller without read access to a field no longer learns the field exists,
  let alone its label, options, formula, or guarding capabilities — the
  metadata plane joins the data plane's FLS posture.
- Unrestricted callers see byte-identical responses; restricted cohorts get
  correct per-cohort `304` semantics.
- `metadata-protocol` is untouched; implementation lands in `rest`,
  `runtime`, and (for D7 fallback resolution) `plugin-security`.
- The `undefined` tier introduces a monitored fail-open window; deployments
  that cannot tolerate even that can front it with the escape hatch inverted
  (mask-or-503 mode) if ever demanded — deliberately out of scope now.
- Follow-ups at implementation time: the D5(4) outlet audit, and wiring the
  fingerprint into any CDN/proxy caching guidance in the deployment docs.
