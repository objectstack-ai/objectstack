# ADR-0103: `managedBy` write policy — split the overloaded `system` bucket, enforce engine-owned writes

- **Status**: Accepted (D5 completed in v17 — see the #3355 addendum at the end:
  the residual `system` bucket is renamed `system-data` and the bare value retired)
- **Date**: 2026-07-19
- **Issue**: #3220 (root cause surfaced by the #1591 / #3213 better-auth guard work; safe slice shipped in #3222)
- **Relates to**: ADR-0049 (no unenforced security properties), ADR-0092 (identity
  write guard mechanism), ADR-0066 (system-row provenance gate)

## Context

`managedBy` is the object-lifecycle bucket UI clients read to render CRUD
affordances, and the security layer reads to enforce matching write defaults.
Its `system` value had come to mean two **incompatible** things:

1. **Engine-owned** — runtime rows a platform service owns end to end and no user
   ever writes directly: `sys_automation_run`, `sys_job` / `sys_job_queue`,
   `sys_notification`, the approval engine's request/approver/token rows, the
   sharing engine's `sys_record_share`, `sys_setting` / `sys_secret` /
   `sys_setting_audit`, metadata history/commit, the messaging delivery pipeline
   (`sys_notification_delivery`, `…_receipt`, `http_delivery`). Every write goes
   through `isSystem: true` / a `SYSTEM_CTX` service engine, or a context-less
   engine call (the messaging service's raw-engine writes, the metadata-protocol
   repository's transaction context — neither carries a `userId`).
2. **Platform-schema, admin/user-writable data** — objects whose *schema* is
   platform-defined but whose *rows* are legitimately written from a user
   context by design:
   - the RBAC link tables `sys_user_position`, `sys_user_permission_set`,
     `sys_position_permission_set` — governed at write time by the
     `DelegatedAdminGate` (ADR-0090 D12), which depends on the write carrying the
     real caller (e.g. `suggested-audience-bindings.ts` inserts a direct grant
     with `context: callerCtx`, deliberately **not** `isSystem`);
   - `sys_user_preference` — a user authors their own preferences (RLS self-grant);
   - `sys_approval_delegation` — user-facing "who covers for me" config;
   - the messaging config grids surfaced in Setup — `sys_notification_preference`
     (a user mutes their own topics), `sys_notification_subscription`,
     `sys_notification_template` (admin-authored).

All three restricted buckets (`system`, `append-only`, `better-auth`) collapsed
to one identical all-false affordance row, but only `better-auth` had real
enforcement: an engine write guard (ADR-0092) plus registration-time
`apiMethods` reconciliation. `system` had **neither**. A blast-radius audit
(#3220) disproved the original "just guard `system` wholesale" proposal — a
blanket guard would break delegated administration and self-service — and
narrowed the safe, mechanical slice to two latent holes (`sys_presence`,
`sys_metadata`), which shipped as #3222. This ADR is the root-cause fix: make the
write policy **expressible and enforced** without breaking the writable set.

> **Not to be confused with** the row-level `managed_by` *provenance* column
> (`'platform' | 'package' | 'admin'`) on `sys_sharing_rule` / `sys_position` /
> `sys_capability`, guarded by `assertSystemRowWriteGate` (ADR-0066). That is a
> per-row provenance axis; this ADR is about the per-object schema bucket. The
> shared word is a coincidence.

## Decision

### D1 — The bucket is a default; the *resolved affordance* is the policy

`managedBy` supplies only the **default** CRUD affordance row. The authoritative,
enforced write policy for an object is `resolveCrudAffordances(schema)` — the
bucket default with `userActions` overrides applied. We do **not** add a new
enum value. Instead:

- **Engine-owned** ≔ an object in the `system` or `append-only` bucket whose
  resolved affordances grant **no** write (`create`/`edit`/`delete` all false) —
  i.e. the bucket default, un-opened.
- **Admin/user-writable** ≔ a `system`/`append-only` object that declares
  `userActions` opening the writes it legitimately takes. `userActions` is an
  affordance declaration, **not** an authorization: the real authz for these
  rows remains the `DelegatedAdminGate` / RLS self-grant / permission sets. The
  declaration exists so the affordance matrix, the `apiMethods` reconciliation,
  and the engine guard below all agree on what the object permits.

Why not a new enum value: a new `managedBy` string falls through to the
fully-editable `platform` default on every already-deployed Console client
(the UI keeps a hand-maintained closed union and an open-ended type), silently
re-granting New/Edit/Delete on an engine table until each client is updated. The
`userActions` approach changes no wire vocabulary, and every UI surface already
honours `userActions`. Splitting the enum later remains possible as a pure
rename on top of the now-correct affordances.

### D2 — Engine write guard for the engine-owned set

A new `system-write-guard` (plugin-security), modelled on the ADR-0092 identity
guard, fails-closed on any **user-context** write to a `system`/`append-only`
object whose resolved affordances do not grant the corresponding verb. Verb →
affordance: `insert → create`, `update`/`upsert` → `edit`,
`delete`/`purge`/`restore` → `delete`, `transfer → edit` (aligned with the
`DelegatedAdminGate` governed-operation set). A write is **user-context** when
`context.userId` is set and `context.isSystem !== true`; `isSystem` and
context-less engine/service writes bypass by construction — exactly the calls the
legitimate engine writers make. It is wired into the security middleware
alongside the other unconditional data-layer gates (package-managed, system-row,
audience-anchor, delegated-admin), after the `isSystem` short-circuit. Denials
raise `PermissionDeniedError` (HTTP 403).

The writable set passes the guard because its `userActions` grant the verb; the
`DelegatedAdminGate` / RLS then adjudicate the principal, unchanged.

### D3 — Generalize `apiMethods` reconciliation beyond `better-auth`

`reconcileManagedApiMethods` (objectql registry) previously ran only for
`better-auth`. It now runs for **every** managed bucket, still purely
affordance-driven: any generic write verb an object advertises in
`enable.apiMethods` that its resolved affordances do not grant is stripped at
registration with a warning, so the HTTP exposure gate answers a clean 405
instead of admitting a write that the engine guard (or permission layer) would
later 403. This makes the contradiction impossible to ship and is the drift
backstop for future `system` objects.

### D4 — Generalize the `/me/permissions` clamp

The hono-server `clampManagedObjectWrites` previously clamped only `better-auth`
objects' advertised affordances. It now clamps `system`/`append-only` too, so the
permissions payload the Console consumes reflects the true (guarded) write
policy.

### D5 — `sys_import_job` writes become attributed system writes

The REST import route created/updated `sys_import_job` under the caller's
context. Those rows are engine-owned (the import worker owns the lifecycle), so
the route now writes them `isSystem`-elevated while preserving `created_by`
attribution, and the object is locked to `apiMethods: ['get', 'list']`. This
keeps the object engine-owned rather than carving a `userActions` exception for
a row users never hand-edit.

## Alternatives considered

- **New `managedBy` enum value** (e.g. `engine`) — rejected: silent
  fully-editable fallthrough on deployed clients, plus enum/matrix churn and
  ~30 re-bucketed declarations across three UI mirrors and ten locale bundles,
  for a distinction `userActions` already expresses. Revisitable later as a
  rename.
- **`writeVia` capability** for third-party-managed objects — deferred (#1878):
  no such object exists today; speculative until a concrete need arises
  (explicitly out of scope per #3220).

## Consequences

- `system`/`append-only` objects reject user-context generic writes unless
  `userActions` opens them — defence-in-depth for non-REST callers, matching the
  HTTP-layer `apiMethods` lock several already carry.
- Third-party or downstream `system` objects that advertised write verbs relying
  on today's fail-open behaviour will have those verbs stripped with a warning —
  the intended ADR-0049 correction, called out in the release note.
- The taxonomy is now honest: a reader can tell engine-owned from writable by the
  resolved affordances, and the guard enforces it.

## Addendum (2026-07-20, v16) — the anticipated enum split lands: explicit `engine-owned` bucket

D1 deferred the enum split ("Splitting the enum later remains possible as a pure
rename on top of the now-correct affordances"). Both reasons D1 cited *against* an
enum value are now retired, so v16 adopts it — additively — as the self-documenting
successor to the engine-owned-DEFAULT overload of `system`.

**Why it is now safe** (the D1 objections, resolved):
1. *Silent fully-editable fallthrough on deployed clients* — neutralised by the
   server-side enforcement this same ADR added: an unknown bucket resolving to the
   `platform` default on an old client is now **cosmetic**, because the engine write
   guard (D2), `apiMethods` reconciliation (D3) and the `/me/permissions` clamp (D4)
   reject the write regardless of what the client renders. (Re-verified end to end
   in the showcase: a generic `/data` create on an engine-owned object returns 405.)
2. *Open-ended UI type across three mirrors* — closed by **objectui#2712**: the
   `ManagedByBucket` union is now a single closed type, so a new value is a compile
   error to miss, not a silent fallthrough.

**The split (additive — `system` is retained, nothing is removed):**
- New enum value **`engine-owned`** with the same all-locked default affordance row
  as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins
  `ENGINE_OWNED_BUCKETS` (guard) and `GUARDED_WRITE_BUCKETS` (clamp); the guard,
  reconciliation and clamp mechanisms are **unchanged** — engine-owned is simply an
  explicit member of the set they already covered by resolved affordance.
- The **20** objects that were `system` with no write-opening `userActions` (the
  metadata store, jobs, approvals runtime rows, sharing rows, automation runs, the
  messaging delivery/receipt pipeline, secrets, settings) are relabelled
  `system → engine-owned` — a one-line, behaviour-identical change per object.
- The **8** objects that are platform-schema **admin/user-writable DATA** (the RBAC
  link tables `sys_user_position` / `sys_user_permission_set` /
  `sys_position_permission_set`, `sys_user_preference`, `sys_approval_delegation`,
  and the messaging config grids) **keep `managedBy: 'system'`**, which now reads as
  "engine-managed schema, writable via `userActions`" — the residual meaning of the
  bucket after the engine-owned rows move out.

**Not a behaviour or enforcement change.** Resolved affordances, the guard verdict,
the 405 reconciliation and the permissions clamp are byte-identical before and
after; this is a self-documenting relabel. No data migration (`managedBy` is schema
metadata, not row data), and no code branches on the `'system'` literal (all
enforcement keys off `resolveCrudAffordances` / the bucket-set membership).

**Sequencing (v16 RC).** The framework enum and the objectui union land together and
the vendored console is re-pinned before GA; during any sync window an old console
renders an unknown `engine-owned` object editable but the server still 405s the
write (point 1). Removing the overloaded `system` entirely — moving the 8 writable
objects to a dedicated writable-platform-data bucket (or `config`) and retiring
`system` — is a genuinely breaking rename deferred to **v17**.

---

## Addendum (v17, #3355) — the deferred half: `system` → `system-data`

The v16 sequencing note above deferred "removing the overloaded `system` entirely"
to v17. This addendum records that close-out. It **completes** D5 rather than
revising it; nothing decided above is reversed.

**What the additive split left behind.** D5 moved the 20 engine-owned objects out
to the explicit `engine-owned` and had the 8 writable ones *keep* `system`. That
was correct for a release that could not break authors, but the value that
remained named the half that had just moved out: "system" sitting on precisely the
objects a user writes. The practical cost is not aesthetic — an author choosing
between `system` and `engine-owned` had nothing in the vocabulary to choose *on*,
so the bucket was re-overloadable by anyone reading the name in good faith, and a
model author most of all ("system table" reads as engine-owned everywhere else).

**Decision.** The residual bucket is renamed **`system-data`** and the bare
`system` value is retired from the load path (the enum rejects it with a
prescription; stored metadata is converted by the ADR-0087 D2 entry
`object-managed-by-system-to-system-data`). The name states both boundaries the
old one hid: the **schema** is the platform's — versus `platform`, which is
tenant-modelled — and the **data** is the admin's or the user's, versus
`engine-owned`, where the engine owns both.

Rejected alternatives: reusing **`config`** (`sys_user_preference` is user-owned,
not admin-authored, and `config` suppresses CSV import — a fresh overload on day
one of the bucket that exists to end one), and **`platform-data`**, which sits one
word from the semantically unrelated `platform` in the same closed enum and would
reintroduce the confusion at the moment of choosing.

**One deliberate consequence — the default flips.** `system` defaulted LOCKED with
each object re-opening its writes via `userActions`; `system-data` defaults
**WRITABLE** (full CRUD), because a bucket whose purpose is to say "the data is
yours" should not make every member ask for it back. The 8 objects' re-open blocks
are therefore deleted, and `userActions` on this bucket now only NARROWS. The
affordance side-effect is that CSV `import` resolves `true` where it resolved
`false` under the locked default — an affordance change only; every row a CSV
import writes is still adjudicated by the `DelegatedAdminGate` / RLS / permission
sets.

**Enforcement is unchanged, as in D5.** `system-data` joins `platform` / `config`
as a bucket neither `ENGINE_OWNED_BUCKETS` (guard) nor `GUARDED_WRITE_BUCKETS`
(clamp) covers — a writable default has nothing to fail closed on. The 8 objects
passed the guard before via `userActions` and pass now via the bucket default, for
the same resolved-affordance reason; equivalence pins in `plugin-security`,
`service-messaging`, `plugin-approvals`, `platform-objects` and
`plugin-hono-server` assert this per object rather than leaving it to argument.

**New in v17 — the mis-assignment refusal.** Because the default is now writable,
mislabelling an engine-owned object into this bucket is no longer harmless: it
advertises generic CRUD on a table that should take no user write, and no guard
covers the bucket to catch it. `ObjectSchema.create()` therefore **refuses**
`system-data` on an object whose resolved affordances grant no create, edit or
delete — a contradiction with no honest reading, computable from the declaration
alone. Partial narrowing stays legal; only the all-writes-false shape is refused.
