# ADR-0120: Uniqueness scope is an explicit vocabulary — declared-index organization scoping and NULL-safe per-organization uniqueness

**Status**: Accepted (2026-08-04, maintainer decision on #4986 / #5030; proposed same day) — implementation not started; the 17.x wave (D7) is the first work package, the protocol-18 items (D2 conversion, bare-`true` rejection) are deliberately deferred to the 18 train
**Deciders**: ObjectStack Protocol Architects (maintainer decision requested on #4986)
**Amends**: the #3696 decision *"a declared index is materialized verbatim — no tenant column is injected"* as recorded in `packages/spec/src/data/object.zod.ts` (`IndexSchema`), `content/docs/data-modeling/indexing.mdx` §*Two ways to say "unique"*, `content/docs/references/data/object.mdx`, the `syncDeclaredIndexes` doc block in `packages/drivers/driver-sql/src/sql-driver.ts`, and lint R10 `unique/double-declaration` (`packages/lint/src/data-model-rules.ts`). Per Prime Directive #13 this reversal is itself a decision and is recorded here — **the verbatim contract is not abolished; it becomes the `'global'` arm of an explicit vocabulary, and every stored declaration keeps its exact current physical shape.**
**Builds on**: [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (D2 conversion layer — this ADR adds one entry), [ADR-0078](./0078-no-silently-inert-metadata.md) (no declarable-but-inert keys — `unique: 'global'` on a declared index is today documented as "changes nothing"; this ADR makes it load-bearing), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — #5030 is a declared-but-unenforced unique constraint), [ADR-0048](./0048-cross-package-metadata-collision.md) (the `COALESCE(col, '')` canonical index key part this ADR reuses), [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) (tenancy posture), [ADR-0113](./0113-required-write-contract-vs-column-constraint.md) (precedent: two look-alike spellings split into explicit, separately-owned contracts)
**Consumers**: `@objectstack/spec` (`IndexSchema`, `UniqueScopeSchema`, conversion registry), `@objectstack/lint` (R10 + one new rule), `driver-sql` (`uniqueIndexesFromFields`, `normalizeDeclaredIndex`, schema-drift both sides, migration planner), `@objectstack/cli` (`os migrate plan` duplicate pre-flight), docs, and every AI metadata author reading the generated JSON Schema
**Surfaced by**: [#4986](https://github.com/objectstack-ai/objectstack/issues/4986) (same intent, two spellings, two semantics — dev stop-work report and PM retraction in the issue thread), [#5030](https://github.com/objectstack-ai/objectstack/issues/5030) (tenant-composite UNIQUE is void on NULL tenant rows — measured, not inferred), [#4698](https://github.com/objectstack-ai/objectstack/issues/4698) (origin instance 2), [#3696](https://github.com/objectstack-ai/objectstack/issues/3696) (the decision being amended), [#4884](https://github.com/objectstack-ai/objectstack/issues/4884) (COALESCE key-part parsing infrastructure this ADR reuses)

---

## TL;DR

Uniqueness on this platform materializes in exactly two physical shapes — the verbatim
column list ("one holder across the whole installation") and the organization composite
("one holder per organization") — and the vocabulary names exactly those two
boundaries. (A third, posture-resolved boundary word was designed and **rejected** —
maintainer ruling: too easy for AI authors to confuse; the rare scenario it served is
handled at the deployment seam instead. See Alternatives and §Posture portability.)
But the authoring surface expresses the choice through
*position*: field-level `unique: true` means per-organization, a declared index means
installation-wide. An author who does not know the convention writes a declared
`{ fields: ['name'], unique: true }` on an organization-scoped object, intends
per-organization, silently gets installation-wide, and no gate says a word (#4986). One
layer down, the per-organization meaning itself is broken where the organization column
is NULL: SQL UNIQUE is NULL-distinct, so on single-org stacks — where the
kernel-injected `organization_id` exists and is always NULL — **every field-level
`unique: true` enforces nothing at all** (#5030, measured).

This ADR replaces position-encoded intent with an **explicit scope vocabulary**, and makes
the per-organization meaning **NULL-safe**:

| # | Decision | One line |
|---|---|---|
| D1 | Scope is said, not inferred | `unique: 'global' \| 'organization'` on **both** spellings; bare `true` on a *declared index* is deprecated (17.x warn → protocol 18 reject) |
| D2 | Stored metadata converts losslessly | ADR-0087 D2 entry rewrites declared-index `unique: true → 'global'` — byte-identical physical shape, **zero drift** |
| D3 | Per-organization unique survives NULL | organization key part materializes as `COALESCE(organization_id, '__global__')` — fixes #5030 for field-level and new `'organization'` indexes alike; ships in 17.x |
| D4 | Tightening migrates through ceremony | `recreate_index` drift + duplicate pre-flight, routed **per index class** — declared/differ-visible through `os migrate plan`, runtime-managed/differ-excluded through `os migrate duplicates` (2026-08-22 amendment); auto-apply only on a clean probe |
| D5 | Authoring gates carry the contract | new lint rule for unscoped declared uniques (authoring-time checkable, no tenancy guessing); R10 rewritten in the new vocabulary |
| D6 | Written surfaces tell one truth | the five #3696 surfaces, the pin tests, and the false single-tenant claim in `UniqueScopeSchema` are updated in the same wave |
| D7 | Staged over 17.x → 18 | additive in 17.x, rejection + conversion at protocol 18 |
| D8 | Freeze until accepted | no unilateral driver-sql semantic change before this ADR is accepted (standing PM order on #4986) |

Governing principles. From ADR-0113: **when one spelling carries two meanings, do not
pick a winner — split the vocabulary and make the author state intent.** From
ADR-0049/0078: a unique constraint that validates clean but enforces nothing is the worst
of the four outcomes; every scenario below must end in either a real constraint or a loud
rejection, never a silent no-op. And a third, stated by the maintainer on #4986 and
binding on every decision here: **app metadata is posture-portable.** The same app
package must run unmodified under every tenancy posture — `single | group | isolated`
(ADR-0105 D1) — and under database-per-customer deployment (an environment-level
choice invisible to metadata); the author states the *business boundary* of a
constraint (per-organization vs installation-wide) — never the posture,
which the author cannot know. See §Posture portability below.

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

Any scope vocabulary whose `'organization'` arm materializes as a NULL-distinct composite
would ship a per-organization option that silently enforces nothing on single-org stacks —
the new vocabulary would be *born* violating ADR-0078. Conversely, fixing #5030 without
the vocabulary leaves the #4986 trap armed. D1/D2 and D3 are therefore one decision
set: **the vocabulary and its enforcement land together.**

### Terminology: why the authorable words avoid "tenant"

"Tenant" is overloaded on this platform, in ways that collide exactly for the
portable-app author this ADR serves:

- **Row-level organization scoping** — the `organization_id` column, RLS, shared
  tables (ADR-0093/0095/0105). Postures: `single | group | isolated` (ADR-0105 D1).
- **Database-per-customer** — each customer's environment carries its own database.
  Explicitly an environment/deployment choice with **no object-level config**
  (`tenancy.strategy` was retired saying exactly this); invisible to metadata.

An authorable `'tenant'` would read differently under each sense. The vocabulary
therefore uses the product's own noun: **`'organization'`** (the boundary is the
organizations feature, whatever the physical topology), plus **`'global'`** for the
whole installation. Rules: the abbreviation `'org'` is
not accepted (the platform spells it out — `organization_id`); `'tenant'` is not
accepted as an alias (PD #12 — one contract, no dialects; the schema's rejection
message for it names `'organization'`). Prose in this ADR says *per-organization* for
the business boundary; "tenant column" / `tenantField` survive only as the historical
physical names inside driver internals, which are not authorable surface and are not
renamed here.

## Business-requirement matrix

The full inventory of uniqueness needs this platform must express, with the spelling and
the materialized truth before and after this ADR. "Void" means the index exists but
constrains nothing on the rows named. (Requested scope for this ADR: cover *all* known
business situations in one pass — this table is that pass; a scenario missing here is a
review gap to be raised on the PR.)

| # | Business need (example) | Spelling today | Enforced today | Spelling after | Enforced after |
|---|---|---|---|---|---|
| S1 | Per-tenant unique field — contact email unique per org | field `unique: true` | MT rows: yes · **single-tenant / NULL-org rows: void (#5030)** | unchanged (`true` stays valid; `'organization'` accepted as explicit synonym) | **always** (D3) |
| S2 | Platform-wide unique field — `stripe_customer_id`, DNS hostname, device identity | field `unique: 'global'` | yes | unchanged | yes |
| S3 | Per-tenant **composite** — case `code` unique per `(org, department)` | declared `['organization_id','department','code']` (author must know to add the org column) | non-NULL rows: yes · NULL-org rows: void | declared `{ fields: ['department','code'], unique: 'organization' }` | **always** (D3); legacy spelling S6 |
| S4 | Platform-wide composite — dedup key `(source, dedup_key)` on `http_delivery` | declared `unique: true` (verbatim) | yes — including NULL-org rows | auto-converted to `'global'` (D2), byte-identical | yes, unchanged |
| S5 | Engine idempotency keys written by sudo (org NULL) — `sys_job.name`, `sys_notification.dedup_key`, + 7 more (#4986 inventory) | declared `unique: true` | yes — these depend on verbatim single/multi-column shape | `'global'` via D2, **zero drift** | yes, unchanged |
| S6 | Legacy hand-written tenant composite — `sys_team ['name','organization_id']` | declared `unique: true`, org column listed | non-NULL rows: yes · NULL-org rows (single-tenant stacks): **void** | converts to `'global'` (D2, zero forced drift); advisory lint suggests the `'organization'` respelling (D5c) | unchanged until the author opts into `'organization'`; then always (via D4 ceremony) |
| S7 | Single-org deployment (incl. each db-per-customer database), any per-organization unique | any organization-scoped spelling | **all void** (#5030 headline) | same spellings | **all real** — NULL bucket constrained (D3) |
| S8 | Mixed population — platform template rows (org NULL) + per-org override rows in one object | field `unique: true` | per-org rows: yes · template rows: unconstrained **among themselves** | unchanged | NULL rows form one platform bucket, unique among themselves (D3) — matches the "NULL = the platform tenant" reading the write path already uses (`GLOBAL_TENANT`) |
| S9 | Autonumber + uniqueness — per-organization sequences (`PROD-00001` per org) | declared composite with org column (docs warn against global) | as S3/S6 | `'organization'` scope pairs with the per-organization sequence by construction | always; optional follow-up lint: `'global'` unique over an autonumber field is flagged |
| S10 | Cross-tenant existence-oracle avoidance (#3696 security rationale) | field `true` only | leaks via S3/S6 NULL-void edge? No — leak was global-index rejections; fixed for fields | `'organization'` extends the no-oracle property to declared composites | a tenant's insert can no longer be rejected by (or reveal) another tenant's values on any `'organization'` index |
| S11 | Tenancy-less objects — `tenancy` disabled or `managedBy: 'better-auth'` (no tenant column) | all spellings | single-column / listed columns | unchanged; `'organization'` degrades to listed columns alone, exactly as field-level `true` already does | unchanged |
| S12 | Non-unique indexes (`unique: false` / omitted), `partial`, index `type` | verbatim | n/a | untouched — this ADR governs *unique scope* only; `'organization'` composes with `partial` (both key-part forms already parse, #4884) | n/a |
| S13 | **Posture-portable app package** — one metadata app, deployed under `single`, `group`, and `isolated` postures (and db-per-customer environments) | field `true` (void on single-org, #5030) or hand-written org composite (author must know the convention *and* the posture trap) | varies by posture; `single`: **void** | `'organization'` for per-org rules — states the business boundary, not the posture | **correct under every posture** — per-org under `group`/`isolated`, deployment-wide under `single` (§Posture portability) |
| S14 | **Company-wide rule in a portable app** — material code / chart of accounts unique across the whole customer company (集团) | inexpressible portably: verbatim is right under `group` but crosses customers under `isolated`; org composite is right under `isolated` but per-subsidiary under `group` | whichever the author guessed — wrong under the other posture | `'global'` (right for the `single`/`group` family the scenario lives in); under `isolated` the deployment seam surfaces it as an explicit decision — confirm or rewrite to `'organization'` (AI-authored install adjustment, §Posture portability) | `single`/`group`: company-wide ✓ · `isolated`: never lands silently — decided at install, not guessed at authoring |

Two properties of this table are the ADR's acceptance criteria:

1. **No cell says "void" in the After columns.** Every declared intent is either enforced
   or loudly rejected (ADR-0049/0078).
2. **Every Before→After transition in S4/S5/S6 is byte-identical on disk** unless the
   author edits metadata (S6 opt-in) — the conversion is semantic bookkeeping, not a
   migration.

## Posture portability: one app package, every tenancy posture

The constraint that shapes the vocabulary (maintainer requirement, #4986): a metadata
app is authored **once** and must run unmodified under every tenancy posture —
`single | group | isolated` (ADR-0105 D1) — and under database-per-customer
deployment, which is an environment-level choice invisible to metadata (inside each
such database the app simply runs whichever posture that environment configures). The
author can decide the *business rule* — which boundary a value is unique within —
because that question has a posture-independent phrasing. The author cannot decide,
and must never be asked to encode, the posture the app will be deployed into.

Both words are posture-invariant *physically* — the same declaration materializes the
same way everywhere:

| Declaration | `single` | `group` (集团 — one corporate family, many orgs, one DB) | `isolated` (租户隔离 — orgs are separate customers) |
|:---|:---|:---|:---|
| `'organization'` | one D3 bucket → deployment-wide | unique within each subsidiary/plant org | unique within each customer org |
| `'global'` — the whole installation, unconditionally | = installation | = the group (the whole corporate family) | **crosses customers** — correct only for infra/dedup keys and genuinely platform-wide reservations (hostnames, external ids); an app business rule almost never means this |

The residual, and its deliberate special handling:

- **"Unique across the whole company" is posture-VARIANT** (S14): under `group` it
  means the installation; under `isolated` it means one organization. A third,
  posture-resolved word (`'company'`) was designed for it and **rejected** —
  maintainer ruling: it is the one word that cannot be used without first
  understanding the posture spectrum, exactly the cognitive load an AI-authored
  vocabulary must not carry, and the scenario (an ISV app with company-wide keys
  shipping across both posture families) is rare (Alternatives #6). Instead: the
  author writes `'global'` — correct for the `single`/`group` family the scenario
  lives in — and the `isolated` deployment seam catches the mismatch below.
- **`'global'` is physically posture-invariant but not *safety*-invariant**: under
  `isolated`, a `'global'` unique on an app business object is almost always meant
  company-wide, not cross-customer — deployed there it both over-constrains and
  becomes a cross-customer existence oracle (S10). Decided (2026-08-04): this is a
  **hard install-time gate**, not an advisory — installing an app that carries
  `'global'` uniques on non-`sys` objects into an `isolated` environment stops and
  lists each index; the installer (typically an AI agent) either confirms it as
  genuinely platform-wide or rewrites it to `'organization'`, and the confirmation
  is recorded in the install manifest (ADR-0104 attestation style) so it is never
  re-asked. `os doctor` / `os migrate plan` keep the same check as an advisory for
  the two cases the gate cannot reach — installs that predate it, and environments
  whose posture changed after install. Never a boot warning (#4884 discipline). The
  benign mirror direction — `'organization'` under `group` constraining
  per-subsidiary rather than group-wide — is under-constraint within one company,
  carries no leak, and is left to the app's install notes.

**Posture transitions are rare, and deliberately not automated** (maintainer ruling,
#4986). A deployment's posture is chosen at setup and effectively never changes; when
it does (an acquisition merges `isolated` customers into a `group`; a `single`
customer enables `group`), that is a planned re-platforming event, not something the
runtime should handle behind anyone's back. With the two-word vocabulary this is now
trivially cheap: **no index shape reads the posture, so a posture change has zero
automatic schema consequences.** What changes is the advisory picture — `'global'`
uniques on app objects become decision points under `isolated` (above), and any scope
rewrites the new posture calls for surface as ordinary D4 drift (`recreate_index`
gated by the duplicate pre-flight, e.g. two merging companies holding the same
material code). Executing the move is an explicit migration task, and per ADR-0087's
operating assumption the migrator is an AI agent: it reads the `os doctor` /
`os migrate plan` output, writes the upgrade script, and applies it deliberately.

Corollary for acceptance: the conformance suite boots the **same fixture app** under
all three postures and asserts each S-row's enforcement in each — posture portability
is tested, not assumed. Transitions get exactly one smoke assertion: a posture flip
by itself emits zero drift ops, and the `isolated`-posture advisory lists a seeded
`'global'` business unique — the listing an AI-authored deployment adjustment starts
from. No transition matrix beyond that.

## Decisions

### D1 — Scope is an explicit vocabulary on both spellings

`UniqueScopeSchema` becomes `boolean | 'global' | 'organization'`, shared by
field-level `unique` and `IndexSchema.unique`:

- **Field-level**: `true` keeps meaning organization-scoped (unchanged since #3696 —
  it is documented, unambiguous, and ubiquitous; churning every schema for symmetry
  would be cost without safety). `'organization'` is accepted as its explicit synonym;
  `'global'` unchanged. Non-normative guidance (decided 2026-08-04): official
  examples, scaffolding, and generators emit `'organization'` rather than `true` in
  new code — the explicit spelling becomes the standard organically, and bare `true`
  stays valid indefinitely.
- **Declared index**: `'global'` = today's verbatim semantics — materialized over
  exactly the listed columns. `'organization'` = the driver prepends the tenant key part
  (D3 form) to the listed columns at registration, where tenancy is known — same shape
  family as field-level composites. On an object with no tenant column, `'organization'`
  degrades to the listed columns alone, mirroring field-level behavior (S11).
- **Deliberately no third word.** A posture-resolved `'company'` boundary ("unique
  within the customer-company that installed the app") was designed and **rejected**
  by maintainer ruling: it would be the one word in the vocabulary that cannot be
  used without first understanding the posture spectrum — exactly the cognitive load
  an AI-authored surface must not carry — for a scenario (S14) that is rare. The
  scenario is handled at the deployment seam instead (§Posture portability;
  Alternatives #6 records the full design).

  Both words name business boundaries, never postures — the same declaration is
  correct under every deployment shape, which is what lets one app package serve all
  of them.

  **Bare `true` on a declared index is retired**: deprecation warning in 17.x (D5a),
  rejected at protocol 18 with a prescriptive error naming the replacements. It is the
  one spelling whose meaning was positional, and it is the trap #4986 documents; an
  explicit statement is cheap for the author and eliminates the class.

Why not silently flip bare `true` to mean `'organization'` after conversion: external
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

### D3 — Organization key part materializes NULL-safe: `COALESCE(organization_id, '__global__')`

All organization-scoped unique materializations — field-level `true`/`'organization'`
and declared `'organization'` — use `COALESCE(organization_id, '__global__')` as the
organization key part instead of the raw column. NULL-organization rows collapse into
one platform bucket, unique among themselves (S7, S8); non-NULL rows are untouched.

The literal is `'__global__'` — a maintainer decision (2026-08-04), flipped from this
draft's earlier `''` — for two reasons: **the constraint-violation error becomes
self-describing** (`Key (COALESCE(organization_id, '__global__'), email)=(__global__,
a@b.com)` reads as "the platform bucket collided" to the AI agent triaging the
incident, where `('', …)` reads as data corruption), and **it is the word the platform
already uses for this bucket** — the autonumber sequence table keys global rows by
`GLOBAL_TENANT = '__global__'`, and #3696's root lesson was two subsystems naming the
same concept differently. Two guardrails come with it: organization creation
**reserves the token** (an org id may never equal `'__global__'`), and the definition
site documents that **storage stays NULL** — the index folds NULL into the bucket;
`WHERE organization_id = '__global__'` matches nothing, by design.

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
  already materializes and *round-trips* this form — ADR-0048 pins `sys_metadata`
  overlays with `COALESCE(package_id, '')`, and #4884 taught the drift reader to
  parse and attribute `COALESCE(col, <literal>) ≡ col` across dialects, literal
  included (`parseIndexDdl`, `classifyIndexKeyPart`). No new dialect floor, no new
  parser.

Drift-detection both sides (declared vs actual) read the same normalization helper, so
no false drift is created — the #4884 lesson, and the #4986 issue text's explicit
requirement.

### D4 — Physical migration goes through the ceremony, with a duplicate pre-flight

D3 changes the physical shape of every existing organization-composite unique index:
`(organization_id, X) → (COALESCE(organization_id, '__global__'), X)`. This is a **pure
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

> **Amendment (2026-08-22, [#8725](https://github.com/objectstack-ai/objectstack/issues/8725) / [#11032](https://github.com/objectstack-ai/objectstack/issues/11032)) — the duplicate pre-flight is per index CLASS: `os migrate plan` for the declared, differ-visible indexes; `os migrate duplicates` for the runtime-managed ones the differ excludes by construction.**
>
> The sentence above — "`os migrate plan` gains a **duplicate pre-flight probe** per affected
> index" — was written for the **declared** class, the `recreate_index` drift ops the
> reconciler can see, and it is true there: `os migrate plan` reports a blocked tightening of
> a declared organization-unique index in full, quoting the offending group and its row count.
>
> It cannot reach a second class. Three `kernel:ready` migrations in
> `packages/metadata-protocol` tighten an index at runtime —
> `ensureMetadataOverlayIndexes` (`sys_metadata`), `ensureViewDefinitionActiveIndex`
> (`sys_view_definition`), `ensureSysSettingIdentityIndex` (`sys_setting`) — and every one of
> them is invisible to the drift differ **by construction**. *After* the tightening,
> `isRuntimeManagedIndex` excludes the index (`isSyncReproducibleIndex` is false for a partial
> index and for a `COALESCE` key part over a non-tenant column), and that exclusion is
> correct — without it a boot would propose rebuilding away the guarantee it just created.
> *Before* it there is nothing to see either: each migration deliberately reuses the DECLARED
> index's name, so the name-matched slot reads as filled whichever physical form is there. A
> command that reports **drift** can therefore never report these rows — measured with a
> matched control, one database carrying the same duplicate damage under both classes, where
> `plan` named the declared index in full and said nothing about the runtime-managed one.
>
> **Ruled (maintainer, 2026-08-22, on #8725).** The pre-flight is per class:
>
> - **declared, differ-visible indexes** → reported through `os migrate plan`, exactly as
>   decided above. Its drift contract is untouched by this amendment.
> - **runtime-managed indexes the differ excludes by construction** → reported through
>   `os migrate duplicates`, which boots read-only and owns the "inventory, never repair"
>   contract.
>
> Everything else D4 decides is unchanged and holds for both classes: the previous index stays
> in place, the report names the key that is not enforced and the rows that block it, and no
> op is auto-applied on a dirty probe.
>
> **The split has an expiry.** It exists only because these three platform indexes are
> tightened at runtime rather than declared. The route #8629's ruling parked to the
> ADR-0120 / v18 train — NULL-safe uniqueness declared in the spec, so a declaration states
> its own row identity and no runtime migration is needed — retires all three migrations, at
> which point the class collapses back into the declared one and the pre-flight has a single
> route again.

### D5 — Authoring gates

a. **New rule `unique/unscoped-declared-index`** (lint + `os validate` publish gate):
   a declared index with bare `unique: true`. 17.x: warning with the prescriptive fix
   ("state `'global'` (installation-wide, today's behavior) or `'organization'` (one
   per organization)").
   Protocol 18: error. Needs no tenancy or posture knowledge — it fires on the
   spelling, which is what makes it the first gate in this saga that can actually run
   at authoring time.
b. **R10 `unique/double-declaration` rewritten** in the vocabulary: field
   `true`/`'organization'` vs declared `'global'` on the same single column = contradiction
   (global wins physically, tenant intent dead); field `'global'` vs declared
   `'global'` = redundancy; field `true` vs declared `'organization'` on the same single
   column = redundancy (same index either way). Message and fix text updated; the
   "spell it out as `['organization_id', X]`" advice is replaced by the `'organization'`
   spelling.
c. **Advisory nudge (S6)**: a declared unique whose column list *contains* the tenant
   column reads as a hand-written tenant composite; suggest the `'organization'` respelling
   (which is also what closes its NULL hole). Advisory only — the legacy spelling
   stays valid and unmigrated forever if untouched (zero forced drift).
d. **Registration-time diagnostic**: `'organization'` on an object with no tenant column
   logs the degrade (S11) once, at registration — informational, matching field-level
   behavior, not a boot warning storm (#4884 discipline).
e. **Install-time posture gate** (decided 2026-08-04): installing an app that carries
   `'global'` uniques on non-`sys` objects into an `isolated` environment is a hard
   stop-and-confirm per index, with confirmations recorded in the install manifest;
   `os doctor` / `os migrate plan` carry the advisory form for pre-gate installs and
   post-install posture changes (§Posture portability).

### D6 — The written surfaces tell one truth, in the same wave

The implementation wave that lands D1–D5 also updates, in the same PRs, every surface
that states the old contract — a partial landing here recreates the declared ≠ enforced
split this ADR exists to close (PD #10):

1. `IndexSchema` comment + `describe()` (→ generated JSON Schema — the copy AI authors
   read) — new vocabulary, pointer to this ADR.
2. `UniqueScopeSchema` doc block — the false "degenerates to the single-column one"
   claim replaced with the D3 truth.
3. `content/docs/data-modeling/indexing.mdx` §*Two ways to say "unique"* — table gains
   the `'organization'` row and loses the trap; the `os:check` block updated.
4. Generated references (`content/docs/references/data/object.mdx`) — regen via
   `gen:schema && gen:docs` (never hand-edited).
5. `syncDeclaredIndexes` doc block — "VERBATIM" statement scoped to `'global'`.
6. `sql-driver-unique-tenancy.test.ts` — contract header gains the scope table;
   *"exactly as authored"* is retained **for `'global'`**; new pins for `'organization'`
   (two tenants may hold the same value; NULL bucket may not), for S7 (single-tenant
   enforcement — the #5030 probe graduates into this suite), and for D2 (nine-key
   inventory unchanged). The *"`'global'` is a synonym of `true`"* pin retires at 18
   together with bare `true`.
7. ADR anchors: `scripts/adr-anchors.json` entries for `normalizeDeclaredIndex`,
   `uniqueIndexesFromFields`, the conversion entry, and R10/R-new (PD #13 corollary —
   leave the id in the code).

### D7 — Staging across 17.x → protocol 18

- **17.x (additive, non-breaking)**: `'organization'` accepted on both spellings; D3
  materialization + D4 drift/probe (decided 2026-08-04: D3 ships here, not at 18 —
  see Resolved questions #3); D5 warnings and the D5e install gate; D6 truth sweep.
  Bare `true` on declared indexes still accepted (warned).
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
- `'organization'` on declared indexes makes the driver's normalize path tenancy-aware for
  declared indexes for the first time; the drift reader's COALESCE handling (#4884)
  must be exercised for tenant key parts too (new tests in D6.6).
- The vocabulary stays at two words by ruling, and the cost is recorded honestly:
  the company-wide-in-a-portable-app scenario (S14) is not expressible in metadata
  alone. The dangerous direction (`'global'` deployed under `isolated`) is caught at
  the deployment seam as an explicit decision point; the benign direction
  (`'organization'` under `group` constraining per-subsidiary rather than
  group-wide) carries no leak and is left to the app's install notes. Cheaper than a
  posture-resolved third word every author must understand first.
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
3. **Re-meaning bare `true` to `'organization'` after conversion**: silent intent flip for
   every out-of-repo author; rejected in D1.
4. **#5030 alternatives A/B/C**: rejected in D3 with reasons inline.
5. **A separate `scope` key instead of widening `unique`**: two keys that are only
   meaningful together (`unique: true, scope: 'organization'`) reintroduce a positional trap
   (what does `scope` alone mean?) and double the surface the conversion must carry.
   One key, one statement.
6. **A third, posture-resolved scope word (`'company'`)** — designed in a draft round
   of this ADR and rejected by maintainer ruling. The design: "unique within the
   customer-company that installed the app", resolved at registration to the verbatim
   shape under `single`/`group` (the installation is the company) and to the
   organization composite under `isolated` (the organization is the company); no
   third physical shape, full S14 portability for ISV apps with company-wide keys.
   Rejected because it is the one word that cannot be used without first
   understanding the ADR-0105 posture spectrum — the highest-cognitive-load token in
   an AI-authored vocabulary, and the likeliest to be confused with `'organization'`
   — while the scenario it serves is rare and has a deployment-seam answer
   (§Posture portability): author `'global'`, decide explicitly at `isolated`
   install. Recorded here per PD #13 so the next author finds the analysis, not just
   the absence; reopening it needs a superseding ADR, and the deployment-seam
   mechanism is the bar it must beat.

## Acceptance tests (definition of done for the implementing wave)

- Matrix invariant 1: for every S-row, either an enforcing index exists (integration
  test inserts the violating pair and expects rejection) or the spelling is rejected at
  validate — no silent third state.
- Posture portability (S13/S14): one fixture app booted under all three postures
  (`single | group | isolated`); every unique declaration's enforcement asserted in
  each. One smoke assertion pins that a posture flip by itself emits zero drift ops
  (no shape reads the posture). The D5e gate is exercised once: installing a fixture
  app with a `'global'` business unique into an `isolated` environment stops, records
  the confirmation, and does not re-ask; the doctor/plan advisory form is asserted
  for a pre-gate install. No transition matrix.
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

## Resolved review questions (maintainer decisions, 2026-08-04)

Four questions were left open by earlier draft rounds; all four are now decided and
folded into the sections above. Recorded here so the reasoning survives review:

1. **COALESCE literal → `'__global__'`** (flipped from the draft's `''`). Deciding
   scenario: the constraint-violation error an AI ops agent reads at incident time —
   `(__global__, a@b.com)` says "platform bucket", `('', …)` reads as corruption.
   Also unifies the bucket's name with the autonumber sequence table's
   `GLOBAL_TENANT` (#3696's lesson: subsystems must not name the same concept
   differently). Guardrails: the token is reserved at organization creation, and the
   definition site documents that storage stays NULL. (D3)
2. **Field-level bare `true` stays valid indefinitely.** It has exactly one
   documented meaning and no trap — deprecation would buy churn, not safety.
   Non-normative guidance: official examples, scaffolding, and generators emit
   `'organization'` in new code, so the explicit spelling becomes the de-facto
   standard organically. (D1)
3. **D3 ships in 17.x.** It fixes declared-but-unenforced behavior (ADR-0049 class),
   and the cost of waiting compounds: every month of delay grows the duplicate sets
   the D4 probe will eventually report. The protocol-18 wave is physically empty
   either way (D2 is zero-drift by construction). Release notes carry an
   AI-executable runbook for probe-reported duplicates. (D7)
4. **The `isolated`-posture decision point is a hard install-time gate**, not an
   advisory. Installing an app that carries `'global'` uniques on non-`sys` objects
   into an `isolated` environment stops and lists each index; the installer
   (typically an AI agent) confirms it as genuinely platform-wide or rewrites it to
   `'organization'`, and the confirmation is recorded in the install manifest
   (ADR-0104 attestation style) so it is never re-asked. `os doctor` /
   `os migrate plan` keep the advisory form for the two cases the gate cannot reach:
   installs that predate it, and environments whose posture changed after install.
   (D5e, §Posture portability)
