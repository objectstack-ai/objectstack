# ADR-0056: Permission Model Landing Verification — Whole-Model Enforce / Prove / Reconcile Audit

**Status**: Proposed (2026-06-20)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (prove-it-runs), [ADR-0055](./0055-master-detail-controlled-by-parent.md) (controlled-by-parent)
**Consumers**: `@objectstack/plugin-security`, `@objectstack/plugin-sharing`, `@objectstack/plugin-org-scoping`, `@objectstack/rest`, `@objectstack/runtime`, `@objectstack/spec`, `@objectstack/verify`
**Surfaced by**: the `current_user.email` / owner-scoped-showcase work (PR #2054), which exposed that the showcase's owner predicate had **never been enforced** (`==` + `current_user.name`, neither accepted by the compiler) — prompting a full-model audit rather than another point fix.

---

## TL;DR

ObjectStack ships a **Salesforce-shaped** authorization model (Profiles/Permission Sets → Object CRUD → FLS → OWD/sharing → RLS → ownership → role hierarchy → sharing rules → record shares → tenancy), declared across ~13 metadata layers in `packages/spec`. ADR-0049 said *every* security property must be **enforced, explicitly `experimental`, or removed*; ADR-0054 said *high-risk authorable properties must carry a runtime proof*. **Neither gate has ever been applied to the model as a whole.** This ADR performs that audit — a per-primitive **declared ↔ enforced ↔ proven** verification — and makes the reconciling decisions: which gaps are *fail-open security bugs to close now*, which are *declared-but-unenforced surfaces to mark `experimental`/remove*, and which *enforced-but-unproven invariants must gain a dogfood proof*. It also makes the audit **durable**: an **Authorization Conformance Matrix** (extending the ADR-0054 liveness ledger to the whole authz surface) so "the model is fully landed" becomes a CI-checked artifact, not a one-time scan.

This ADR is explicitly **not** a permission-model rewrite (the model is correct and industry-aligned). It is the *landing verification* of a model that is ~60% enforced, ~35% proven, and carries several silent fail-open holes.

---

## Context

### The model is sound; its landing is uneven

A read-only audit (four parallel passes: spec inventory, runtime-enforcement trace, proof-coverage matrix, prior-ADR reconciliation) produced the picture below. The primitives are the right ones and the mental model is coherent. The problem is **uneven landing**: some primitives are enforced + proven, several are declared but silently do nothing (fail-OPEN — the metadata *lies*), and several are enforced but unproven (one refactor from silent regression).

This matters more for a metadata-driven, AI-authored platform than for a hand-coded app: an author (human or AI) writes `sharingModel: 'public_read'` or `owner = current_user.name` and gets **no error and no enforcement** — a false sense of compliance, which ADR-0049 names as worse than an absent feature.

### Governing precedent (do not re-litigate)

- **ADR-0049** — a security property must be **enforced** / **`experimental`-tagged** / **absent**. It already *removed* the spec forms of `PolicySchema`, `SharingRuleSchema`, flow `runAs`, and the `allowTransfer/Restore/Purge` ops (roadmapped M2). Any "gap" this ADR finds must be reconciled against what 0049 already decided.
- **ADR-0054** — high-risk authorable classes carry a dogfood **proof** bound in the liveness ledger (`packages/spec/scripts/liveness/proof-registry.mts`). Five classes are bound today: `field-type`, `rls-sharing`, `sharing-controlled-by-parent`, `analytics`, `flow-node`.
- **ADR-0055** — owner/master-detail derivation reuses the existing `rlsMembership` + IN-form; **no RLS compiler subquery support** is a deliberate architectural constraint.

### The authorization model, as declared (condensed)

| Layer | Primitive(s) | Spec home |
| :-- | :-- | :-- |
| Identity / tenancy | User, Session(`activeOrganizationId`), Member(`role`), ApiKey(`scopes`/`permissions`), Organization | `spec/identity/*`, `kernel/execution-context.zod.ts` |
| RBAC | Role(+`parent` hierarchy), PermissionSet(`isProfile`), ObjectPermission(CRUD + `viewAll/modifyAll`), FieldPermission(FLS) | `spec/security/permission.zod.ts`, `spec/identity/role.zod.ts` |
| Record-level / OWD | `object.sharingModel`, `OWDModel`, Criteria/Owner SharingRule, `publicSharing` link policy, `sys_record_share` | `spec/data/object.zod.ts`, `spec/security/sharing.zod.ts` |
| RLS | `RowLevelSecurityPolicy`(`using`/`check`/`operation`/`roles`/`priority`), `RLSConfig`(`defaultPolicy`), helpers | `spec/security/rls.zod.ts` |
| Ownership / tenancy | `owner_id`/`created_by` system fields, `TenancyConfig`, org auto-stamp | `spec/data/object.zod.ts`, `plugin-org-scoping` |
| System / UI gating | `systemPermissions[]`, `tabPermissions`, `managedBy`, `apiEnabled/apiMethods` | `spec/security/permission.zod.ts`, `spec/data/object.zod.ts` |
| Compliance (declared) | GDPR/HIPAA/PCI configs, Encryption, Masking, DataClassification, RLSAuditEvent, SecurityContext | `spec/system/*` |

---

## The verification table (the centerpiece)

Legend — **E** enforced · **P** partial · **U** declared-but-unenforced (fail-open) · **N** not-implemented · **✗pf** no end-to-end proof.

| # | Primitive | Enforced? | Enforcement site (evidence) | Proven e2e? | Verdict |
| :-- | :-- | :-: | :-- | :-: | :-- |
| 1 | Object CRUD (`allowRead/Create/Edit/Delete`) | **E** | `plugin-security/security-plugin.ts` ~`326` checkObjectPermission (fail-closed 403) | partial (delete ✗pf) | OK; add DELETE proof |
| 2 | FLS read-mask / write-deny | **E** | `security-plugin.ts` ~`441`/`530`, `field-masker.ts` | unit only ✗pf | OK; **prove FLS+RLS composition** |
| 3 | RLS `using` (read) | **E** | `security-plugin.ts` ~`504` AND-inject; `rls-compiler.ts` | ✓ `rls-fixture` | OK |
| 4 | RLS `check` (insert/update) | **E** | `security-plugin.ts` write path | ✓ `rls-fixture` | OK |
| 5 | RLS by-id write (#1994) | **E** | `security-plugin.ts` ~`361` pre-image re-read | ✓ `rls-fixture` | OK |
| 6 | RLS compiler grammar | **P** | `rls-compiler.ts` — only `=`(id/email/org)/`IN`/literal/`1=1`; **uncompilable predicates silently dropped** | unit | **D4: no silent drop** |
| 7 | `current_user.*` vars | **P** | resolves `id`,`email`,`organization_id`,`org_user_ids`,`rlsMembership`; **`name` excluded by design** | unit | OK (documented) |
| 8 | OWD `private` (owner-only) | **P** | `plugin-sharing/sharing-service.ts` ~`53` `effectiveSharingModel` — **only if sharing plugin loaded** | ✓ `rls-fixture` | **D1/D3** |
| 9 | OWD `read` / `public_read` | **U** | `read` handled; `public_read` falls through to "public" (no filter) | ✗pf | **D1** |
| 10 | OWD `read_write`/`full`/`public_read_write` | **U** | all collapse to default-ALLOW; no distinction | ✗pf | **D1 (fail-open)** |
| 11 | `controlled_by_parent` | **E** | `security-plugin.ts` ~`864`/`908` (read+write) | ✓ `controlled-by-parent`, `showcase-invoice-cbp` | OK (ADR-0055) |
| 12 | Ownership `owner_id` stamp + scope | **E** | `security-plugin.ts` ~`479` auto-stamp; owner RLS | ✓ `rls-fixture` | OK |
| 13 | Manual record shares (`sys_record_share`) | **E** | `sharing-service.ts` ~`117` buildReadFilter | unit ✗pf | OK; add proof |
| 14 | Sharing rules (criteria/owner) | **P** | rules materialize into `sys_record_share`; **spec CEL `condition`+recipients diverge from runtime `criteria_json`** | unit ✗pf | **D5 (spec↔runtime reconcile, per 0049)** |
| 15 | Role hierarchy widening (`parent`) | **N** | `sharing-rule-service.ts` ~`253` `expandRecipient` has no `role_and_subordinates` case (declared in the enum, never expanded); `team-graph.ts:27` flat; no consumer of `Role.parent` | ✗ | **D6: implement or `experimental`** |
| 16 | Multi-tenant org isolation | **E** | `plugin-org-scoping` ~`129` stamp + wildcard RLS + field-existence fail-closed | ✓ `rls-multitenant` | OK |
| 17 | Anonymous / unauthenticated | **P/U** | `rest-server.ts` `requireAuth` **defaults false**; no context ⇒ checks skipped ⇒ reads unscoped data | unit ✗pf | **D2 (fail-open, HIGH)** |
| 18 | `systemPermissions` / tab-app gating | **E** | `rest-server.ts` ~`1069` filterAppForUser (server-side) | ✗pf | OK; add proof |
| 19 | Default/fallback provisioning | **P** | `security-plugin.ts` ~`724` hardcoded `member_default`; **not app-declarable** | unit ✗pf | **D7** |
| 20 | `allowTransfer/Restore/Purge`, `Policy`, flow `runAs` | **(removed)** | — | — | already 0049 → M2, leave |
| 21 | Compliance / Encryption / Masking / `RLSConfig` / DataClassification | **U** | declared in `spec/system/*`; no runtime consumer found | ✗ | **D8: triage per 0049** |

**Headline numbers:** ~12/21 enforced cleanly, ~5 partial, ~3 fail-open/unenforced, 1 not-implemented; only ~7 invariants carry an end-to-end proof. Three fail-open holes are security-relevant: **#10 OWD collapse**, **#17 anonymous default-allow**, **#15 role-hierarchy no-op**.

---

## Decision

The governing rule (ADR-0049): each gap resolves to **enforce now**, **mark `experimental`**, or **remove**. The governing rule (ADR-0054): each *enforced* high-risk invariant gains a **proof**. Below, one decision per gap.

### D1 — Reconcile the OWD model to a single canonical enum, and enforce or reject every value

There is a **three-way mismatch**: `object.sharingModel` = `{private, read, read_write, full, controlled_by_parent}`; `OWDModel` = `{private, public_read, public_read_write, controlled_by_parent}`; runtime `effectiveSharingModel` understands only `{private, read, → public}`. Result: `public_read`, `public_read_write`, `read_write`, `full` are **declared-but-unenforced** and silently collapse to default-allow.

- **Collapse to one canonical OWD enum**: `private`, `public_read`, `public_read_write`, `controlled_by_parent`. Make `object.sharingModel` reference exactly this enum (drop the divergent `read`/`read_write`/`full` aliases, or map them as deprecated aliases for one release).
- The engine must enforce **all** canonical values (`public_read` = world-readable + owner/permission-set-write; `public_read_write` = no record filter). **A `sharingModel` value the runtime does not enforce is a compile error** (authoring gate), not a silent fallthrough.
- Default when unset stays today's behavior (no owner filter), documented explicitly.

### D2 — Close the anonymous fail-open hole (default-deny)

`requireAuth` defaulting to `false` (`rest-server.ts`) means an anonymous request to an object with no RLS/sharing reads **everything** — the documented "anonymous traffic still bypasses enforcement" gap.

- **Adopt default-deny for authenticated-data routes**: an unauthenticated principal gets the **deny baseline**, not "no checks." Public exposure must be *explicit* (`publicSharing` opt-in / share-link tokens / an explicit `requireAuth:false` per deployment).
- Anonymous + no `publicSharing` ⇒ 401/empty, never unscoped rows. Mirror the change in the analytics read-scope path (so anonymous aggregates are equally scoped).

### D3 — Owner/OWD enforcement must not depend on whether `plugin-sharing` is loaded

`private` is enforced in `plugin-sharing/sharing-service.ts`; `controlled_by_parent` and owner RLS in `plugin-security`. A stack with security but **without** sharing silently loses `private` enforcement — a composition fail-open.

- **The OWD baseline (`private`/`public_read`) is part of the security baseline**, owned by `plugin-security` (or a hard dependency it asserts at init). `plugin-sharing` adds the *widening* layer (rules, manual shares, hierarchy) on top, never the *baseline*. Boot asserts the baseline owner is present (fail-closed if a `private` object would otherwise be unprotected).

### D4 — RLS compiler must never silently drop an uncompilable predicate

A `using` clause the compiler can't parse (e.g. `==`, `name`, AND/OR, ranges) is dropped; if it was the only policy, the object silently loses that protection (the exact class that hid the showcase bug for two PRs).

- **Authoring-time**: `objectstack compile` / spec validation **errors** on a `using`/`check` the compiler cannot compile (unknown var, unsupported shape) — no silently-inert predicates ship.
- **Runtime**: an uncompilable policy that slips through is treated as **deny** (fail-closed), and logged at WARN with the policy name — never dropped to allow.

### D5 — Reconcile Sharing Rules' spec↔runtime divergence (per ADR-0049)

The spec declares `CriteriaSharingRuleSchema`/`OwnerSharingRuleSchema` with a CEL `condition` and recipients incl. `role_and_subordinates`/`guest`; the runtime reads a **different** shape (`sys_sharing_rule.criteria_json`, recipients user/team/department/role/queue) and does **not** evaluate the spec's CEL form. ADR-0049 already removed the old `SharingRuleSchema`; the surviving spec schemas are **declared-but-unenforced as written**.

- **Pick one canonical shape.** Either (a) make the runtime read the spec schema (enforce it), or (b) align the spec schema to the enforced `criteria_json`/recipient set and **mark the unenforced parts (CEL `condition`, `role_and_subordinates`, `guest`) `[EXPERIMENTAL — not enforced]`** per ADR-0049 until evaluated. No third "looks-authorable-but-isn't" state.

### D6 — Role-hierarchy widening: implement, or mark `experimental`

`Role.parent` exists and is documented as "managers see subordinates," but no code consumes it: `expandRecipient` (`sharing-rule-service.ts:253`) resolves a `role` recipient to its **direct** members only and has **no `role_and_subordinates` branch** (the enum value ships, unexpanded). It is **silently a no-op** — a 0049 violation. (Department hierarchy *is* walked — `department-graph.ts:32` — so the gap is role-specific.)

- **Decision: mark `Role.parent`'s visibility-rollup semantics `[EXPERIMENTAL — not enforced]`** in the spec now (it is not on the critical path for v1), with a roadmap entry to implement it as a `rlsMembership` pre-resolution (`current_user.subordinate_user_ids`) reusing the ADR-0055 IN-form — **no compiler change**. (Implementing now is acceptable if cheap; the default is honest-tagging over a silent no-op.)

### D7 — First-class app-declared **default Profile** (replaces the hardcoded fallback)

The runtime hardcodes `fallbackPermissionSet = 'member_default'`; an app cannot declare that its self-registered users are, say, `contributor`. This is why `pnpm dev` can't demonstrate owner isolation out of the box.

- **Model a default Profile as metadata** (an `isDefault` flag on a Profile-type permission set, or a `defaultProfile` field on the org/app security config). The runtime (`dev-plugin`, `serve.ts`, `resolve-execution-context`) resolves the fallback from this declaration; the platform `member_default` remains the least-privilege floor. Per-tenant override is allowed; this is the first brick for SSO/JIT provisioning.

### D8 — Triage the compliance/encryption/masking surface per ADR-0049

GDPR/HIPAA/PCI configs, Encryption, Masking, DataClassification, `RLSConfig`, `RLSAuditEvent`, `SecurityContext` are richly declared with **no runtime consumer**. Per ADR-0049 they cannot remain parsed-but-silent.

- **Mark each `[EXPERIMENTAL — not enforced]` with an M2/M3 roadmap pointer, or remove**, exactly as 0049 did for `PolicySchema`. This ADR does not design these subsystems; it forbids them from masquerading as enforced. (Recommendation: `experimental`-tag, since they encode real roadmap intent and have compliance value as documentation.)

### D9 — Bind the enforced-but-unproven invariants into the liveness ledger

Per ADR-0054, extend the bound high-risk classes with the authorization invariants that are enforced but only unit-tested. Add dogfood proofs + ledger rows for: **FLS+RLS composition**, **OWD `private`/`public_read` end-to-end**, **manual record share grant→read→revoke**, **object DELETE permission**, **anonymous default-deny (D2)**, and **default-Profile provisioning (D7)**. Each lands with its PR (ratchet, not retrofit), bound on the relevant `ledgerBindings` path (`object.sharingModel`, `permission.fields`, `rowLevelSecurity`, etc.).

### D10 (durable) — An Authorization Conformance Matrix as a checked artifact

The one-time table above rots. Make it a **living ledger**: extend the ADR-0054 proof-registry concept to the *whole* authorization surface — one row per primitive carrying `{declared-at, enforcement-site (file:line or "experimental"/"removed"), proof-ref}`. CI asserts every authz primitive is in exactly one ADR-0049 state and (if high-risk + enforced) carries a proof. "The permission model is fully landed" becomes a green check, and any new fail-open (a declared sharing value with no enforcement site) breaks the build. **This is the durable deliverable** — the audit, encoded.

---

## Consequences

**Positive.**
- Every authorization primitive ends in a known, *honest* state (enforced / experimental / removed) — no silent fail-open.
- Three real security holes close (OWD collapse, anonymous default-allow, owner-without-sharing-plugin).
- The model becomes **self-verifying** (D10): regressions and new unenforced surfaces fail CI, not production.
- Unblocks turnkey owner-scoped demos and the SSO/JIT provisioning roadmap (D7).
- Authoring-time errors (D1/D4) make the model **AI-safe**: a generated `sharingModel`/`using` that wouldn't enforce is rejected, not silently inert.

**Negative / costs.**
- **Default-deny (D2) is behavior-changing** — existing deployments relying on anonymous reads must opt in explicitly. Gate behind a release note + migration; consider a one-release warn-then-enforce.
- Collapsing the OWD enum (D1) touches the authorable spec surface; existing `read`/`read_write`/`full` usages need migration (alias-deprecate for one release).
- Marking compliance/masking/encryption `experimental` (D8) visibly downgrades perceived capability — but it is the honest state and 0049 mandates it.
- Security-critical code paths → every phase requires dogfood proofs + review (cost is intended).

**Neutral / open.**
- Whether security/RBAC objects move to a dedicated `plugin-rbac` (ADR-0029 left this open) — out of scope here.
- Final home of the default-Profile declaration (org policy vs app manifest vs permission-set flag) — to be fixed in the D7 PR.
- Whether role-hierarchy widening (D6) ships in this cycle or stays `experimental` — evidence-gated.

## Non-goals

- **Not** a permission-model rewrite — the Salesforce-shaped model stays; this is landing verification.
- **Not** designing the compliance/encryption/masking subsystems (D8 only triages their *status*).
- **Not** adding RLS-compiler subquery support (ADR-0055 constraint stands; widening uses pre-resolved `rlsMembership`).
- **Not** ServiceNow-style per-row ACL scripts, nor client-side enforcement (server is the boundary).

## Alternatives considered

- **(a) Keep point-fixing (one gap per incident).** Rejected — that is how the showcase predicate stayed inert for two PRs; the model needs a whole-surface gate, not another patch.
- **(b) One mega-PR enforcing everything.** Rejected — security-critical; unreviewable; violates the ADR-0054 "ratchet, not retrofit" posture.
- **(c) Audit doc only, no durable artifact.** Rejected — a static audit rots; D10's conformance matrix is what keeps the model landed.
- **(d, chosen) Audit → per-gap 0049/0054 reconciliation → conformance matrix**, delivered as independently-shippable phases.

## Phasing (each phase independently shippable, each with proofs)

- **P1 — Honesty pass (no behavior change).** D8 + D5 + D6 tagging (`experimental`/remove), D4 authoring-time error + runtime fail-closed-on-uncompilable, D1 enum reconciliation + reject-unknown. Establishes "no silent fail-open." Plus D10 scaffold (conformance matrix skeleton).
- **P2 — Close the fail-open holes.** D1 enforce `public_read`/`public_read_write`, D3 OWD baseline in security plugin, D2 anonymous default-deny (warn→enforce). Each with a dogfood proof (D9).
- **P3 — Provisioning + proofs.** D7 default-Profile, remaining D9 proofs (FLS+RLS, manual shares, DELETE), turnkey showcase migration to `sharingModel: private`.
- **P4 (evidence-gated).** D6 role-hierarchy widening implementation; SSO/JIT provisioning building on D7.

## References

- ADR-0049 (no unenforced security properties), ADR-0054 (runtime proof), ADR-0055 (controlled-by-parent), ADR-0010 (metadata protection), ADR-0029 (kernel object ownership).
- Audit evidence: `plugin-security/src/security-plugin.ts`, `rls-compiler.ts`; `plugin-sharing/src/sharing-service.ts`, `sharing-rule-service.ts`; `rest/src/rest-server.ts`; `runtime/src/security/resolve-execution-context.ts`; `spec/src/security/{permission,rls,sharing}.zod.ts`, `spec/src/data/object.zod.ts`.
- Liveness ledger: `packages/spec/scripts/liveness/proof-registry.mts`. Implementation status: `content/docs/concepts/implementation-status.mdx`, `content/docs/guides/security.mdx`.

---

## Implementation status (2026-06-20)

The decisions landed incrementally, each with a runtime proof:

| Decision | Status | Proof / artifact |
| :-- | :-- | :-- |
| OWD scenarios (private + public-read) | ✅ landed | `showcase-private-owd`, `showcase-public-read-owd` dogfood |
| D1 — canonical OWD vocabulary | ✅ landed | `plugin-sharing` units + OWD dogfood |
| D2 — anonymous deny (default flip) | ✅ landed (**enforced**) | `showcase-anonymous-deny` dogfood on the platform default; spec `requireAuth` `default(true)` |
| D4 — RLS compiler no-silent-drop | ✅ landed | `plugin-security` units |
| D6 — configurable role hierarchy | ✅ landed | `RoleGraphService` units (`role_and_subordinates`) |
| D7 — app-declared default profile | ✅ landed | `showcase-default-profile` dogfood |
| D8 — experimental-tag unenforced surface | ✅ landed | spec markers + liveness |
| **D10 — conformance matrix** | ✅ landed | `authz-conformance.matrix.ts` + `.test.ts` (CI-checked) |
| D6/D7 e2e showcase, requireAuth flip | follow-on | see below |

### `requireAuth` default-flip readiness (pre-flip audit)

Flipping the global `requireAuth` default to secure-by-default is **release-gated**. A
pre-flip audit of the legitimate anonymous surfaces found:

- **Share links** — SAFE. `share-link-service.ts` validates the token then reads under a
  **system context** (`SYSTEM_CTX`), so it does not depend on the anonymous fail-open and
  survives a deny flip.
- **Control-plane** (`/auth`, `/health`, `/discovery`) — exempt via dispatcher skip-paths.
- **Public forms** — AT RISK. `/forms/:slug/submit` bypasses `enforceAuth` but the INSERT
  relies on a `guest_portal` profile to scope it; `guest_portal` is **not built-in** (only
  the CRM example defines one), so under a deny flip, public forms break unless the
  deployment ships a `guest_portal` profile.

**Pre-requisite for the flip:** make public-form submission self-authorizing (grant INSERT
on the form's declared target object) or ship a built-in `guest_portal`, then warn→enforce
with a migration note.

**Flip status (2026-07): LANDED.** The pre-requisite was satisfied by the
declaration-derived `publicFormGrant` (Option A — self-authorizing public-form submission,
proven by `showcase-public-form` / `form-self-auth` dogfood). The global default is now
deny: spec `requireAuth` `default(true)` + `rest-server.ts` `?? true`. An explicit
`requireAuth: false` opt-out remains available for deployments that intentionally serve
data publicly and is surfaced with a boot warning (the previous warn-state behavior,
now scoped to the explicit opt-out). The CLI keeps one carve-out: a stack with no `auth`
tier cannot authenticate anyone, so `objectstack serve` passes an explicit `false` for it
(warned). The verify harness boots on the platform default, so every dogfood proof runs
under the flipped posture. Conformance row: `requireAuth-default-flip` → `enforced`.
