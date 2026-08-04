# ADR-0120: Uniqueness scope is an explicit vocabulary — declared-index tenant scoping and NULL-safe tenant uniqueness

**Status**: Proposed (draft 2026-08-04, #4986 / #5030 — awaiting maintainer acceptance)
**Deciders**: ObjectStack Protocol Architects (maintainer decision requested on #4986)
**Amends**: the #3696 decision *"a declared index is materialized verbatim — no tenant column is injected"* as recorded in `packages/spec/src/data/object.zod.ts` (`IndexSchema`), `content/docs/data-modeling/indexing.mdx` §*Two ways to say "unique"*, `content/docs/references/data/object.mdx`, the `syncDeclaredIndexes` doc block in `packages/plugins/driver-sql/src/sql-driver.ts`, and lint R10 `unique/double-declaration` (`packages/lint/src/data-model-rules.ts`). Per Prime Directive #13 this reversal is itself a decision and is recorded here — **the verbatim contract is not abolished; it becomes the `'global'` arm of an explicit vocabulary, and every stored declaration keeps its exact current physical shape.**
**Builds on**: [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (D2 conversion layer — this ADR adds one entry), [ADR-0078](./0078-no-silently-inert-metadata.md) (no declarable-but-inert keys — `unique: 'global'` on a declared index is today documented as "changes nothing"; this ADR makes it load-bearing), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — #5030 is a declared-but-unenforced unique constraint), [ADR-0048](./0048-cross-package-metadata-collision.md) (the `COALESCE(col, '')` canonical index key part this ADR reuses), [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) (tenancy posture), [ADR-0113](./0113-required-write-contract-vs-column-constraint.md) (precedent: two look-alike spellings split into explicit, separately-owned contracts)
**Consumers**: `@objectstack/spec` (`IndexSchema`, `UniqueScopeSchema`, conversion registry), `@objectstack/lint` (R10 + one new rule), `driver-sql` (`uniqueIndexesFromFields`, `normalizeDeclaredIndex`, schema-drift both sides, migration planner), `@objectstack/cli` (`os migrate plan` duplicate pre-flight), docs, and every AI metadata author reading the generated JSON Schema
**Surfaced by**: [#4986](https://github.com/objectstack-ai/objectstack/issues/4986) (same intent, two spellings, two semantics — dev stop-work report and PM retraction in the issue thread), [#5030](https://github.com/objectstack-ai/objectstack/issues/5030) (tenant-composite UNIQUE is void on NULL tenant rows — measured, not inferred), [#4698](https://github.com/objectstack-ai/objectstack/issues/4698) (origin instance 2), [#3696](https://github.com/objectstack-ai/objectstack/issues/3696) (the decision being amended), [#4884](https://github.com/objectstack-ai/objectstack/issues/4884) (COALESCE key-part parsing infrastructure this ADR reuses)

---

## TL;DR

Uniqueness on this platform has exactly two business meanings — **platform-wide** ("one
holder of this value across the whole installation") and **per-tenant** ("one holder per
organization") — but the authoring surface expresses them through *position*: field-level
`unique: true` means per-tenant, a declared index means platform-wide. An author who does
not know the convention writes a declared `{ fields: ['name'], unique: true }` on a
tenant-scoped object, intends per-tenant, silently gets platform-wide, and no gate says a
word (#4986). One layer down, the per-tenant meaning itself is broken where the tenant
column is NULL: SQL UNIQUE is NULL-distinct, so on single-tenant stacks — where the
kernel-injected `organization_id` exists and is always NULL — **every field-level
`unique: true` enforces nothing at all** (#5030, measured).

This ADR replaces position-encoded intent with an **explicit scope vocabulary**, and makes
the per-tenant meaning **NULL-safe**:

| # | Decision | One line |
|---|---|---|
| D1 | Scope is said, not inferred | `unique: 'global' \| 'tenant'` on **both** spellings; bare `true` on a *declared index* is deprecated (17.x warn → protocol 18 reject) |
| D2 | Stored metadata converts losslessly | ADR-0087 D2 entry rewrites declared-index `unique: true → 'global'` — byte-identical physical shape, **zero drift** |
| D3 | Per-tenant unique survives NULL | tenant key part materializes as `COALESCE(tenantField, '')` (ADR-0048 canonical form) — fixes #5030 for field-level and new `'tenant'` indexes alike |
| D4 | Tightening migrates through ceremony | `recreate_index` drift + duplicate pre-flight in `os migrate plan`; auto-apply only on a clean probe |
| D5 | Authoring gates carry the contract | new lint rule for unscoped declared uniques (authoring-time checkable, no tenancy guessing); R10 rewritten in the new vocabulary |
| D6 | Written surfaces tell one truth | the five #3696 surfaces, the pin tests, and the false single-tenant claim in `UniqueScopeSchema` are updated in the same wave |
| D7 | Staged over 17.x → 18 | additive in 17.x, rejection + conversion at protocol 18 |
| D8 | Freeze until accepted | no unilateral driver-sql semantic change before this ADR is accepted (standing PM order on #4986) |

Governing principles. From ADR-0113: **when one spelling carries two meanings, do not
pick a winner — split the vocabulary and make the author state intent.** From
ADR-0049/0078: a unique constraint that validates clean but enforces nothing is the worst
of the four outcomes; every scenario below must end in either a real constraint or a loud
rejection, never a silent no-op. And a third, stated by the maintainer on #4986 and
binding on every decision here: **app metadata is deployment-mode portable.** The same
app package must run unmodified in single-organization and multi-organization
deployments; the author states the *business boundary* of a constraint (per-organization
vs per-installation) — never the topology, which the author cannot know. See §Mode
portability below.

## Context

### The two-spelling collision (#4986)

Field-level `unique: true` on a tenant-scoped object materializes as a composite
`(organization_id, field)` — unique *within* the tenant (#3696). A declared
`indexes: [{ fields, unique: true }]` materializes over exactly the listed columns —
platform-wide. Both are deliberate, and the #3696 rationale for the verbatim arm is
sound: many declared indexes are legitimately platform-wide (a DNS hostname, a reserved
slug, an external provider id, every engine dedup key), and the author already spelled
the columns out.

What #4986's investigation established (stop-work report, verified by the PM and again
by this ADR's author against `main`):

- The verbatim behavior is **contract, not accident** — written on five surfaces and
  pinned by `sql-driver-unique-tenancy.test.ts` (*"leaves declared object-level indexes
  exactly as authored"*).
- The originally-ruled fix — inject the tenant column in `normalizeDeclaredIndex` —
  would have silently rewritten **nine engine-owned idempotency/dedup keys**
  (`sys_job.name`, `sys_notification.dedup_key`, `http_delivery (source, dedup_key)`,
  `sys_presence.session_id`, `sys_email_template (name, locale)`,
  `notification_delivery` / `_receipt` / `_subscription` / `_preference`) into
  composites that, on the NULL tenant rows sudo writers produce, **enforce nothing**
  (see #5030 below) — converting real platform-wide constraints into no constraints,
  with dev `autoMigrate: 'safe'` applying the downgrade at boot.
- Yet the authoring hazard is real: nothing warns the author whose declared unique was
  *meant* per-tenant. The existing lint (R10) fires only when both spellings appear on
  the same column, and authoring-time tenancy inference is impossible by design —
  `organization_id` is kernel-injected at registration, not authored
  (`data-model-rules.ts` says so in its own comment).

So the defect is not in either semantics; it is that **intent is encoded by position**,
and one of the two positions reads as the other's synonym.

### The NULL hole (#5030)

`applySystemFields` supplies `organization_id` unconditionally (only
`managedBy: 'better-auth'` objects are exempt); the multi-tenant switch governs only
whether the column is *indexed*, not whether it exists. On a single-tenant stack the
column therefore exists and is NULL on every row. `computeTenantField` still reports it
as the tenant field, `uniqueIndexesFromFields` still builds `(organization_id, field)`,
and SQL's NULL-distinct semantics make `(NULL, 'dup@example.com')` insertable any number
of times. Measured outcome: **on single-tenant deployments, every field-level
`unique: true` is a silent no-op.** The same hole applies to platform-global rows
(tenant column NULL) on multi-tenant stacks, and to the hand-written legacy composites
(`sys_team ['name','organization_id']`, `sys_business_unit ['code','organization_id']`,
`sys_member ['organization_id','user_id']`) on any row where the tenant column is NULL.

The `UniqueScopeSchema` doc block's exemption — *"the tenant column is constant, so the
composite index degenerates to the single-column one"* — is false when the constant is
NULL: it degenerates to **no constraint**. This is exactly the ADR-0049/0078 class:
declared, documented, validated clean, unenforced.

### Why these two issues are one ADR

Any scope vocabulary whose `'tenant'` arm materializes as a NULL-distinct composite
would ship a per-tenant option that silently enforces nothing on single-tenant stacks —
the new vocabulary would be *born* violating ADR-0078. Conversely, fixing #5030 without
the vocabulary leaves the #4986 trap armed. D1/D2 and D3 are therefore one decision
set: **the vocabulary and its enforcement land together.**

## Business-requirement matrix

The full inventory of uniqueness needs this platform must express, with the spelling and
the materialized truth before and after this ADR. "Void" means the index exists but
constrains nothing on the rows named. (Requested scope for this ADR: cover *all* known
business situations in one pass — this table is that pass; a scenario missing here is a
review gap to be raised on the PR.)

| # | Business need (example) | Spelling today | Enforced today | Spelling after | Enforced after |
|---|---|---|---|---|---|
| S1 | Per-tenant unique field — contact email unique per org | field `unique: true` | MT rows: yes · **single-tenant / NULL-org rows: void (#5030)** | unchanged (`true` stays valid; `'tenant'` accepted as explicit synonym) | **always** (D3) |
| S2 | Platform-wide unique field — `stripe_customer_id`, DNS hostname, device identity | field `unique: 'global'` | yes | unchanged | yes |
| S3 | Per-tenant **composite** — case `code` unique per `(org, department)` | declared `['organization_id','department','code']` (author must know to add the org column) | non-NULL rows: yes · NULL-org rows: void | declared `{ fields: ['department','code'], unique: 'tenant' }` | **always** (D3); legacy spelling S6 |
| S4 | Platform-wide composite — dedup key `(source, dedup_key)` on `http_delivery` | declared `unique: true` (verbatim) | yes — including NULL-org rows | auto-converted to `'global'` (D2), byte-identical | yes, unchanged |
| S5 | Engine idempotency keys written by sudo (org NULL) — `sys_job.name`, `sys_notification.dedup_key`, + 7 more (#4986 inventory) | declared `unique: true` | yes — these depend on verbatim single/multi-column shape | `'global'` via D2, **zero drift** | yes, unchanged |
| S6 | Legacy hand-written tenant composite — `sys_team ['name','organization_id']` | declared `unique: true`, org column listed | non-NULL rows: yes · NULL-org rows (single-tenant stacks): **void** | converts to `'global'` (D2, zero forced drift); advisory lint suggests the `'tenant'` respelling (D5c) | unchanged until the author opts into `'tenant'`; then always (via D4 ceremony) |
| S7 | Single-tenant deployment, any per-tenant unique | any tenant-scoped spelling | **all void** (#5030 headline) | same spellings | **all real** — NULL bucket constrained (D3) |
| S8 | Mixed population — platform template rows (org NULL) + per-org override rows in one object | field `unique: true` | per-org rows: yes · template rows: unconstrained **among themselves** | unchanged | NULL rows form one platform bucket, unique among themselves (D3) — matches the "NULL = the platform tenant" reading the write path already uses (`GLOBAL_TENANT`) |
| S9 | Autonumber + uniqueness — per-tenant sequences (`PROD-00001` per org) | declared composite with org column (docs warn against global) | as S3/S6 | `'tenant'` scope pairs with the per-tenant sequence by construction | always; optional follow-up lint: `'global'` unique over an autonumber field is flagged |
| S10 | Cross-tenant existence-oracle avoidance (#3696 security rationale) | field `true` only | leaks via S3/S6 NULL-void edge? No — leak was global-index rejections; fixed for fields | `'tenant'` extends the no-oracle property to declared composites | a tenant's insert can no longer be rejected by (or reveal) another tenant's values on any `'tenant'` index |
| S11 | Tenancy-less objects — `tenancy` disabled or `managedBy: 'better-auth'` (no tenant column) | all spellings | single-column / listed columns | unchanged; `'tenant'` degrades to listed columns alone, exactly as field-level `true` already does | unchanged |
| S12 | Non-unique indexes (`unique: false` / omitted), `partial`, index `type` | verbatim | n/a | untouched — this ADR governs *unique scope* only; `'tenant'` composes with `partial` (both key-part forms already parse, #4884) | n/a |
| S13 | **Mode-portable app package** — one metadata app, deployed both single-org and multi-org | field `true` (void on single-org, #5030) or hand-written org composite (author must know the convention *and* the topology trap) | multi-org: yes · single-org: **void** | `'tenant'` — states the business boundary, not the topology | **correct in both modes** — per-org under multi-org, deployment-wide under single-org (§Mode portability) |

Two properties of this table are the ADR's acceptance criteria:

1. **No cell says "void" in the After columns.** Every declared intent is either enforced
   or loudly rejected (ADR-0049/0078).
2. **Every Before→After transition in S4/S5/S6 is byte-identical on disk** unless the
   author edits metadata (S6 opt-in) — the conversion is semantic bookkeeping, not a
   migration.

## Mode portability: one app package, both deployment modes

The constraint that shapes the vocabulary (maintainer requirement, #4986): a metadata
app is authored **once** and must run unmodified under both deployment modes. The
author can decide the *business rule* — "is this value one-per-organization, or
one-per-installation?" — because that question has a mode-independent answer. The
author cannot decide, and must never be asked to encode, the *topology* the app will
be deployed into. The vocabulary satisfies this because both words name the business
boundary, and D3 is what makes the single-org degradation real rather than nominal
(#5030 is precisely the vocabulary-shaped hole where it used to be a lie):

| Declaration | Multi-org deployment | Single-org deployment |
|:---|:---|:---|
| `'tenant'` | unique within each organization (the isolation boundary) | the deployment **is** one organization data space (the D3 bucket) → deployment-wide unique — exactly what the same business rule means there |
| `'global'` | unique across the whole installation, all organizations | deployment-wide unique — physically coincides with `'tenant'`, semantically distinct (see transitions below) |

**Mode transitions are part of the contract.** The physical coincidence of the two
scopes under single-org is temporary state, not equivalence — the day the deployment
changes mode, the declarations diverge, and the fact that the author *stated* the
scope is what makes the transition mechanical:

- **Single-org → multi-org** (a customer enables organizations): every `'tenant'`
  constraint *relaxes* from deployment-wide to per-org — a pure loosening; existing
  rows keep their bucket, new organizations open their own scopes, no violation is
  possible, **zero migration**. `'global'` constraints do not move. Had the intent
  been positional (bare `true`), this transition would have no right answer.
- **Multi-org → single-org** (consolidation): `'tenant'` constraints *tighten* —
  previously-separate org scopes merge, duplicates across former orgs are possible,
  and the change goes through the D4 ceremony (drift op + duplicate pre-flight,
  operator resolves collisions before the constraint lands). Never silent.

Corollary for acceptance: the conformance suite must boot the **same fixture app** in
both modes and assert each S-row's enforcement in each (see Acceptance tests) — mode
portability is tested, not assumed.

## Decisions

### D1 — Scope is an explicit vocabulary on both spellings

`UniqueScopeSchema` becomes `boolean | 'global' | 'tenant'`, shared by field-level
`unique` and `IndexSchema.unique`:

- **Field-level**: `true` keeps meaning tenant-scoped (unchanged since #3696 — it is
  documented, unambiguous, and ubiquitous; churning every schema for symmetry would be
  cost without safety). `'tenant'` is accepted as its explicit synonym; `'global'`
  unchanged.
- **Declared index**: `'global'` = today's verbatim semantics — materialized over
  exactly the listed columns. `'tenant'` = the driver prepends the tenant key part
  (D3 form) to the listed columns at registration, where tenancy is known — same shape
  family as field-level composites. On an object with no tenant column, `'tenant'`
  degrades to the listed columns alone, mirroring field-level behavior (S11).
  Both words are **deployment-mode-invariant** (§Mode portability): they name the
  business boundary relative to the organization, never the topology — the same
  declaration is correct under single-org and multi-org deployment, which is what
  lets one app package serve both.
  **Bare `true` on a declared index is retired**: deprecation warning in 17.x (D5a),
  rejected at protocol 18 with a prescriptive error naming both replacements. It is the
  one spelling whose meaning was positional, and it is the trap #4986 documents; an
  explicit statement is cheap for the author and eliminates the class.

Why not silently flip bare `true` to mean `'tenant'` after conversion: external
examples, old snippets, and AI training corpora still carry bare `true` with
platform-wide intent; re-meaning it would spring the #4986 trap in mirror image, with
the failure mode inverted and still silent. Rejection is loud, prescriptive, and
authoring-time checkable **without tenancy inference** — which is what makes it
enforceable at lint/publish at all (the #4698 dead-end).

### D2 — One ADR-0087 D2 conversion entry; stored metadata never breaks

New conversion `declared-index-unique-scope` (`toMajor: 18`): every declared-index
`unique: true` in stored/loaded metadata rewrites to `unique: 'global'`. Lossless by
construction — `'global'` *is* the current semantics — so the physical index shape is
byte-identical and schema-drift sees **nothing**. Applies on every seam ADR-0087
defines, including `applyConversionsToStoredItem` for `sys_metadata` rows at rest.
Fixture: the S4/S5 shapes. The nine-key inventory (S5) is the regression corpus: the
conversion's test asserts their expected-index output is identical before and after.

Field-level `unique: true` is **not** converted — it is not deprecated (D1).

### D3 — Tenant key part materializes NULL-safe: `COALESCE(tenantField, '')`

All tenant-scoped unique materializations — field-level `true`/`'tenant'` and declared
`'tenant'` — use `COALESCE(organization_id, '')` as the tenant key part instead of the
raw column. NULL-tenant rows collapse into one platform bucket, unique among themselves
(S7, S8); non-NULL rows are untouched. Empty string cannot collide with a real tenant
id (tenant ids are non-empty by contract).

Why this mechanism, against the #5030 alternatives:

- **(A) Write a sentinel at rest** (`GLOBAL_TENANT = '__global__'`): touches every
  write path, RLS read predicate, and requires a full-table backfill; the driver
  today deliberately stores NULL (`sql-driver.ts` maps `GLOBAL_TENANT → null` on
  write). Highest blast radius. Rejected for now; remains the long-term option if a
  future ADR makes the platform tenant first-class.
- **(B) `computeTenantField → null` when multi-tenant is off**: fixes single-tenant
  stacks but leaves the multi-tenant NULL-row hole (S8) open — half a fix that
  re-forks semantics by deployment mode. Rejected.
- **(C) PostgreSQL `NULLS NOT DISTINCT`**: PG-15-only; SQLite/MySQL have no
  equivalent — a dialect semantics fork. Rejected.
- **(D — chosen) COALESCE key part**: zero write-path/RLS/data changes; the platform
  already materializes and *round-trips* this exact form — ADR-0048 pins
  `sys_metadata` overlays with `COALESCE(package_id, '')`, and #4884 taught the drift
  reader to parse and attribute `COALESCE(col, <literal>) ≡ col` across dialects
  (`parseIndexDdl`, `classifyIndexKeyPart`). No new dialect floor, no new parser.

Drift-detection both sides (declared vs actual) read the same normalization helper, so
no false drift is created — the #4884 lesson, and the #4986 issue text's explicit
requirement.

### D4 — Physical migration goes through the ceremony, with a duplicate pre-flight

D3 changes the physical shape of every existing tenant-composite unique index:
`(organization_id, X) → (COALESCE(organization_id,''), X)`. This is a **pure
tightening** (non-NULL rows: identical; NULL rows: previously unconstrained, now
constrained), surfaced as `recreate_index` drift ops. Because tightening can collide
with pre-existing duplicate NULL-row data — data the old index wrongly admitted —
`os migrate plan` gains a **duplicate pre-flight probe** per affected index:

- Probe clean → the op is eligible for auto-apply under dev `autoMigrate: 'safe'`,
  like any `replace_unique_index` entry (#3728 machinery).
- Probe finds duplicates → the op is **never auto-applied**; the plan reports the
  offending rows (object, columns, duplicate values, row counts) and the operator
  resolves data first. The old index stays in place meanwhile — at no point is a
  constraint dropped without its replacement being creatable.

No constraint-*relaxing* rebuild exists under this ADR by construction; the migration
planner asserts that invariant.

### D5 — Authoring gates

a. **New rule `unique/unscoped-declared-index`** (lint + `os validate` publish gate):
   a declared index with bare `unique: true`. 17.x: warning with the prescriptive fix
   ("state `'global'` (platform-wide, today's behavior) or `'tenant'` (per-tenant)").
   Protocol 18: error. Needs no tenancy knowledge — it fires on the spelling, which is
   what makes it the first gate in this saga that can actually run at authoring time.
b. **R10 `unique/double-declaration` rewritten** in the vocabulary: field
   `true`/`'tenant'` vs declared `'global'` on the same single column = contradiction
   (global wins physically, tenant intent dead); field `'global'` vs declared
   `'global'` = redundancy; field `true` vs declared `'tenant'` on the same single
   column = redundancy (same index either way). Message and fix text updated; the
   "spell it out as `['organization_id', X]`" advice is replaced by the `'tenant'`
   spelling.
c. **Advisory nudge (S6)**: a declared unique whose column list *contains* the tenant
   column reads as a hand-written tenant composite; suggest the `'tenant'` respelling
   (which is also what closes its NULL hole). Advisory only — the legacy spelling
   stays valid and unmigrated forever if untouched (zero forced drift).
d. **Registration-time diagnostic**: `'tenant'` on an object with no tenant column
   logs the degrade (S11) once, at registration — informational, matching field-level
   behavior, not a boot warning storm (#4884 discipline).

### D6 — The written surfaces tell one truth, in the same wave

The implementation wave that lands D1–D5 also updates, in the same PRs, every surface
that states the old contract — a partial landing here recreates the declared ≠ enforced
split this ADR exists to close (PD #10):

1. `IndexSchema` comment + `describe()` (→ generated JSON Schema — the copy AI authors
   read) — new vocabulary, pointer to this ADR.
2. `UniqueScopeSchema` doc block — the false "degenerates to the single-column one"
   claim replaced with the D3 truth.
3. `content/docs/data-modeling/indexing.mdx` §*Two ways to say "unique"* — table gains
   the `'tenant'` row and loses the trap; the `os:check` block updated.
4. Generated references (`content/docs/references/data/object.mdx`) — regen via
   `gen:schema && gen:docs` (never hand-edited).
5. `syncDeclaredIndexes` doc block — "VERBATIM" statement scoped to `'global'`.
6. `sql-driver-unique-tenancy.test.ts` — contract header gains the scope table;
   *"exactly as authored"* is retained **for `'global'`**; new pins for `'tenant'`
   (two tenants may hold the same value; NULL bucket may not), for S7 (single-tenant
   enforcement — the #5030 probe graduates into this suite), and for D2 (nine-key
   inventory unchanged). The *"`'global'` is a synonym of `true`"* pin retires at 18
   together with bare `true`.
7. ADR anchors: `scripts/adr-anchors.json` entries for `normalizeDeclaredIndex`,
   `uniqueIndexesFromFields`, the conversion entry, and R10/R-new (PD #13 corollary —
   leave the id in the code).

### D7 — Staging across 17.x → protocol 18

- **17.x (additive, non-breaking)**: `'tenant'` accepted on both spellings; D3
  materialization + D4 drift/probe; D5 warnings; D6 truth sweep. Bare `true` on
  declared indexes still accepted (warned).
- **Protocol 18**: D2 conversion active; bare `true` on declared indexes rejected at
  validate/publish with the prescriptive error; the synonym pin retires.
- Changesets per package as usual; the ADR-0087 registries (`spec-changes`,
  upgrade-guide) regenerate with the conversion entry (`gen:spec-changes`,
  `gen:upgrade-guide`).

### D8 — Freeze until accepted

Until this ADR's status is Accepted, the standing order from #4986 holds: **no
unilateral semantic change in driver-sql**, no spec/lint edits implementing this
direction. (This draft itself is a docs-only PR.)

## Consequences

**Gains.** The #4986 trap class is structurally closed — intent is stated, the
un-stated spelling dies at authoring time, and neither meaning can be written by
accident. #5030 is fixed for every scenario in the matrix, including the two the
original probe did not name (S6 legacy composites after opt-in, S8 mixed populations).
The nine engine idempotency keys are untouched, provably (D2's regression corpus). The
existence-oracle property (#3696) extends to declared composites (S10).

**Costs, stated honestly.**

- A wide but mechanical index rebuild wave on deployed databases (every tenant-composite
  unique), gated by D4's probe. On healthy multi-tenant data the rebuild is a no-op
  content-wise and auto-applies in dev; on single-tenant databases the probe may surface
  **real duplicate data** that the void constraint admitted — that is the defect
  becoming visible, and it needs an operator, not an auto-migration.
- Two lint rules and the conversion entry to maintain until 18 retires the transitional
  states.
- `'tenant'` on declared indexes makes the driver's normalize path tenancy-aware for
  declared indexes for the first time; the drift reader's COALESCE handling (#4884)
  must be exercised for tenant key parts too (new tests in D6.6).
- Protocol 18 is the earliest point at which bare `true` can be rejected; until then
  the trap is warned, not closed. Accepting a full major of warning-only is the price
  of not breaking third-party authors mid-major (ADR-0059/0087 discipline).

**Explicitly out of scope.** Making the platform tenant first-class at rest
(sentinel storage, alternative A) — a future ADR may supersede D3's COALESCE with it;
D3 is forward-compatible (the bucket exists either way). Case-insensitive uniqueness,
cross-object uniqueness, and conditional (`partial`) unique semantics — unchanged and
orthogonal (S12).

## Alternatives considered and rejected

1. **Driver-side tenant injection into declared uniques** (the retracted #4986 ruling):
   reverses a five-surface contract without vocabulary, converts nine platform
   constraints into NULL-void composites, and makes `'global'` load-bearing while the
   spec documents it as a no-op. Rejected in full — see the issue thread's stop-work
   report; this ADR is the sanctioned replacement.
2. **Diagnostics only, no vocabulary** (#4698's original ask): without `'global'` as a
   real word on declared indexes, every engine dedup key warns at every boot — the
   #4884 false-alarm class. Diagnosis needs the vocabulary; once the vocabulary
   exists, refusing bare `true` is strictly stronger than warning about it. Subsumed
   into D5.
3. **Re-meaning bare `true` to `'tenant'` after conversion**: silent intent flip for
   every out-of-repo author; rejected in D1.
4. **#5030 alternatives A/B/C**: rejected in D3 with reasons inline.
5. **A separate `scope` key instead of widening `unique`**: two keys that are only
   meaningful together (`unique: true, scope: 'tenant'`) reintroduce a positional trap
   (what does `scope` alone mean?) and double the surface the conversion must carry.
   One key, one statement.

## Acceptance tests (definition of done for the implementing wave)

- Matrix invariant 1: for every S-row, either an enforcing index exists (integration
  test inserts the violating pair and expects rejection) or the spelling is rejected at
  validate — no silent third state.
- Mode portability (S13): one fixture app booted under single-org **and** multi-org
  configuration; every unique declaration's enforcement asserted in both modes, plus
  the single-org → multi-org transition (loosening, zero migration ops emitted) and
  the reverse (tightening surfaces as D4 ops, never auto-applied over duplicates).
- Matrix invariant 2: expected-index output for the S4/S5/S6 corpus is byte-identical
  before/after D2 on an untouched database (drift plan is empty).
- The #5030 probe, as a permanent regression test, on both single-tenant and
  multi-tenant NULL-row shapes.
- D4 probe: a seeded duplicate NULL-row dataset yields a blocked op with a row report,
  and `autoMigrate: 'safe'` does not apply it; deduplicating the rows unblocks it.
- Lint: bare declared `true` warns in 17.x fixtures; R10's four-quadrant matrix has a
  fixture per quadrant.
- `check:docs` / `check:api-surface` / `check:spec-changes` / `check:upgrade-guide` /
  `check:adr-anchors` green — the generated surfaces carry the new vocabulary.

## Open questions for review

1. **COALESCE literal**: `''` (this draft, matches ADR-0048) vs `'__global__'`
   (matches the write path's `GLOBAL_TENANT` constant). `''` is collision-safe and
   already round-trips through the drift reader; `'__global__'` is more self-describing
   in `\d`-style index listings. Draft picks `''`; cheap to flip before acceptance.
2. **Field-level bare `true`**: this draft keeps it valid indefinitely (unambiguous,
   ubiquitous). Should it eventually require the explicit `'tenant'` as well, for one
   uniform rule? Draft says no — deprecation should buy safety, and there is no trap
   on that spelling.
3. **D3 timing**: land the COALESCE materialization in 17.x (this draft — it is a fix
   to declared-but-unenforced behavior, not a contract change) or hold it for 18 with
   the rest? Landing in 17.x means single-tenant stacks get real constraints a major
   earlier; holding means one migration wave instead of two.
